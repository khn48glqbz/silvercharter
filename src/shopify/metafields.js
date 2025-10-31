// src/shopify/metafields.js
import { graphqlPost } from "./graphql.js";

/**
 * Set both source_url and condition metafields on a product.
 * productId: numeric or GID suffix (the existing code stores numeric id)
 * sourceUrl: string
 * condition: string (e.g. "Damaged", "Ungraded", "Grade 9")
 */
export async function setProductMetafields(productId, sourceUrl, condition) {
  try {
    const cleanUrl = String(sourceUrl || "").split("?")[0];
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
        value: String(condition || "").trim() || "Ungraded",
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
      // keep logs minimal
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
 * Returns the first matching product node (or null).
 *
 * Note: this uses the storefront admin 'query' string which supports searching metafields via:
 *   metafields.namespace.key:"value"
 *
 * Both values are quoted to handle spaces; we also escape double quotes if present.
 */
export async function findProductBySourceUrlAndCondition(sourceUrl, condition) {
  try {
    const cleanUrl = String(sourceUrl || "").split("?")[0].replace(/"/g, '\\"');
    const cond = String(condition || "Ungraded").replace(/"/g, '\\"');

    // Build a Shopify product search query that matches both metafields
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
                      barcode
                      inventoryItem { id }
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
    return edge;
  } catch (err) {
    console.warn("Failed to query product by source_url & condition:", err.response?.status || err.message || err);
    return null;
  }
}
