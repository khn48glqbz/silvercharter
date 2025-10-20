import { graphqlPost } from "./graphql.js";

export async function setSourceUrlMetafield(productId, sourceUrl) {
  try {
    const ownerId = `gid://shopify/Product/${productId}`;
    const metaGql = {
      query: `
        mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id namespace key value }
            userErrors { field message }
          }
        }
      `,
      variables: {
        metafields: [
          {
            namespace: "pricecharting",
            key: "source_url",
            type: "single_line_text_field",
            value: sourceUrl,
            ownerId,
          }
        ],
      }
    };
    const metaRes = await graphqlPost(metaGql);
    const errors = metaRes?.data?.metafieldsSet?.userErrors;
    if (errors?.length) console.warn("Metafield errors:", JSON.stringify(errors, null, 2));
    else console.log(`Metafield pricecharting.source_url set on product ${productId}`);
    return metaRes;
  } catch (err) {
    console.warn("Failed to set metafield:", err.response?.status, err.response?.data || err.message);
    throw err;
  }
}
