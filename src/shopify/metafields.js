// src/shopify/metafields.js
import { graphqlPost } from "./graphql.js";

/**
 * Set both source_url and condition metafields on a product.
 * productId: numeric or GID suffix
 * fields: { sourceUrl: string, condition: string }
 */
export async function setProductMetafields(productId, fields = {}) {
  try {
    const cleanUrl = String(fields.sourceUrl || "").split("?")[0];
    const cond = String(fields.condition || "Ungraded").trim() || "Ungraded";
    const ownerId = `gid://shopify/Product/${productId}`;

    const metafields = [
      {
        namespace: "pricecharting",
        key: "source_url",
        type: "single_line_text_field",
        value: cleanUrl,
        ownerId,
      },
      {
        namespace: "pricecharting",
        key: "condition",
        type: "single_line_text_field",
        value: cond,
        ownerId,
      },
    ];

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

    const res = await graphqlPost(gql);
    const errors = res?.data?.metafieldsSet?.userErrors;
    if (errors?.length) {
      console.warn("Metafield set returned userErrors:", JSON.stringify(errors, null, 2));
    } else {
      console.log(`Set metafields pricecharting.source_url and pricecharting.condition on product ${productId}`);
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
export async function findProductBySourceUrlAndCondition(sourceUrl, condition) {
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
                metafields(first: 10, namespace: "pricecharting") {
                  edges { node { key value } }
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

    const metafields = Object.fromEntries(
      (node.metafields?.edges || []).map((e) => [e.node.key, e.node.value])
    );

    return {
      id: node.id,
      title: node.title,
      variantId: variantNode?.id,
      inventoryItemId: variantNode?.inventoryItem?.id,
      price: parseFloat(variantNode?.price || 0),
      barcode: variantNode?.barcode || "",
      sourceUrl: metafields.source_url || "",
      condition: metafields.condition || "",
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
export async function getShopifyLocationId() {
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

    const locationId = edge.node.id;
    console.log(`Using Shopify location: ${edge.node.name} (${locationId})`);
    return locationId;
  } catch (err) {
    console.warn("Failed to fetch Shopify location ID:", err.message || err);
    return null;
  }
}
