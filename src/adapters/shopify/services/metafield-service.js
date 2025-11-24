// src/shopify/metafields.js
import { graphqlPost } from "../client/graphql.js";

let cachedLocationId = null;
let cachedLocationIdStr = null;

function normalizeOwnerId(productId) {
  const raw = String(productId || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://")) return raw;
  const numeric = raw.replace(/\D/g, "") || raw;
  return `gid://shopify/Product/${numeric}`;
}

/**
 * Set both source_url and condition metafields on a product.
 * productId: numeric or GID suffix
 * fields: { sourceUrl: string, condition: string }
 */
export async function setProductMetafields(productId, fields = {}) {
  try {
    const cleanUrl = String(fields.sourceUrl || "").split("?")[0];
    const cond = String(fields.condition || "Ungraded").trim() || "Ungraded";
    const game = (fields.game || "").trim();
    const expansion = (fields.expansion || "").trim();
    const language = (fields.language || "").trim();
    const type = (fields.type || "").trim();
    const expansionIconId = (fields.expansionIconId || "").trim();
    const rawValue = fields.value;
    const signature = typeof fields.signature === "boolean" ? fields.signature : null;
    const ownerId = normalizeOwnerId(productId);

    const metafields = [];

    if (cleanUrl) {
      metafields.push({
        namespace: "pricecharting",
        key: "source_url",
        type: "single_line_text_field",
        value: cleanUrl,
        ownerId,
      });
    }

    if (cond) {
      metafields.push({
        namespace: "pricecharting",
        key: "condition",
        type: "single_line_text_field",
        value: cond,
        ownerId,
      });
    }

    if (game) {
      metafields.push({
        namespace: "pricecharting",
        key: "game",
        type: "single_line_text_field",
        value: game,
        ownerId,
      });
    }

    if (expansion) {
      metafields.push({
        namespace: "pricecharting",
        key: "expansion",
        type: "single_line_text_field",
        value: expansion,
        ownerId,
      });
    }

    if (language) {
      metafields.push({
        namespace: "pricecharting",
        key: "language",
        type: "single_line_text_field",
        value: language,
        ownerId,
      });
    }

    if (type) {
      metafields.push({
        namespace: "pricecharting",
        key: "type",
        type: "single_line_text_field",
        value: type,
        ownerId,
      });
    }

    if (expansionIconId) {
      metafields.push({
        namespace: "pricecharting",
        key: "expansion_icon",
        type: "file_reference",
        value: expansionIconId,
        ownerId,
      });
    }

    if (rawValue !== undefined && rawValue !== null) {
      let valueStr = String(rawValue);
      if (!valueStr.trim()) valueStr = "N/A";
      metafields.push({
        namespace: "pricecharting",
        key: "value",
        type: "single_line_text_field",
        value: valueStr,
        ownerId,
      });
    }

    if (signature !== null) {
      metafields.push({
        namespace: "pricecharting",
        key: "signature",
        type: "single_line_text_field",
        value: signature ? "true" : "false",
        ownerId,
      });
    }

    const gql = {
      query: `
        mutation setMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id namespace key value }
            userErrors { field message }
          }
        }
      `,
      variables: { metafields },
    };

    if (!metafields.length) {
      console.log(`No metafield changes for product ${productId}`);
      return null;
    }

    const res = await graphqlPost(gql);
    const errors = res?.data?.metafieldsSet?.userErrors;
    if (errors?.length) {
      console.warn("Metafield set returned userErrors:", JSON.stringify(errors, null, 2));
    } else {
      console.log(`Updated pricecharting metafields on product ${productId}`);
    }
    return res;
  } catch (err) {
    console.warn("Failed to set product metafields:", err.response?.status || err.message || err);
    throw err;
  }
}

/**
 * Find a product by BOTH source_url and condition metafields.
 */
export async function findProductBySourceUrlAndCondition(sourceUrl, condition, options = {}) {
  const desiredSigned = !!options.signed;
  try {
    const cleanUrl = String(sourceUrl || "").split("?")[0].replace(/"/g, '\\"');
    const cond = String(condition || "Ungraded").replace(/"/g, '\\"');

    const productQuery = `metafields.pricecharting.source_url:"${cleanUrl}" metafields.pricecharting.condition:"${cond}"`;

    const gql = {
      query: `
        query ($q: String!) {
          products(first: 1, query: $q) {
            edges {
              node {
                id
                vendor
                title
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price
                      barcode
                      inventoryItem { id }
                    }
                  }
                }
                metafields(first: 15, namespace: "pricecharting") {
                  edges {
                    node {
                      key
                      value
                      type
                      reference {
                        ... on MediaImage {
                          id
                          image { url }
                        }
                        ... on GenericFile {
                          id
                          url
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      variables: { q: productQuery },
    };

    const res = await graphqlPost(gql);
    const edge = res?.data?.products?.edges?.[0] || null;
    if (!edge) return null;

    const node = edge.node;
    const variantNode = node.variants?.edges?.[0]?.node;

    const metafields = {};
    for (const edge of node.metafields?.edges || []) {
      const key = edge.node.key;
      metafields[key] = {
        value: edge.node.value,
        type: edge.node.type,
        reference: edge.node.reference || null,
      };
    }

    const signatureFlag = (metafields.signature?.value || "").toLowerCase() === "true";
    if (desiredSigned !== signatureFlag) return null;

    return {
      id: node.id,
      title: node.title,
      vendor: node.vendor || "",
      variantId: variantNode?.id,
      inventoryItemId: variantNode?.inventoryItem?.id,
      price: parseFloat(variantNode?.price || 0),
      barcode: variantNode?.barcode || "",
      sourceUrl: metafields.source_url?.value || "",
      condition: metafields.condition?.value || "",
      game: metafields.game?.value || "",
      expansion: metafields.expansion?.value || "",
      language: metafields.language?.value || "",
      type: metafields.type?.value || "",
      expansionIcon: metafields.expansion_icon?.reference?.id || "",
      value: metafields.value?.value ?? null,
      signed: signatureFlag,
    };
  } catch (err) {
    console.warn("Failed to query product by source_url & condition:", err.message || err);
    return null;
  }
}

/**
 * Fetch the Shopify location ID (for inventory updates)
 * Returns the first active location ID, or null on failure.
 */
export async function getShopifyLocationId(forceRefresh = false) {
  if (cachedLocationId && !forceRefresh) return cachedLocationId;
  try {
    const gql = {
      query: `
        {
          locations(first: 1) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      `,
    };

    const res = await graphqlPost(gql);
    const edge = res?.data?.locations?.edges?.[0];
    if (!edge) {
      console.warn("No Shopify locations found via API");
      return null;
    }

    cachedLocationId = edge.node.id;
    cachedLocationIdStr = cachedLocationId ? String(cachedLocationId) : null;
    console.log(`Using Shopify location: ${edge.node.name} (${cachedLocationId})`);
    return cachedLocationId;
  } catch (err) {
    console.warn("Failed to fetch Shopify location ID:", err.message || err);
    return null;
  }
}

export function getCachedLocationId() {
  return cachedLocationId;
}

export function getCachedLocationIdStr() {
  return cachedLocationIdStr;
}
