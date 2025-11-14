import { graphqlPost } from "./graphql.js";

const PRODUCTS_QUERY = `
  query ($cursor: String) {
    products(first: 50, after: $cursor, query: "metafields.pricecharting.source_url:*") {
      edges {
        cursor
        node {
          id
          title
          vendor
          handle
          tags
          metafields(first: 20, namespace: "pricecharting") {
            edges {
              node {
                key
                value
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                id
                barcode
                price
                inventoryQuantity
                inventoryItem { id }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function mapMetafields(edges = []) {
  return Object.fromEntries((edges || []).map((edge) => [edge.node.key, edge.node.value]));
}

export async function fetchAllPricechartingProducts(progressCb) {
  const results = [];
  let cursor = null;
  while (true) {
    const variables = cursor ? { cursor } : {};
    const res = await graphqlPost({ query: PRODUCTS_QUERY, variables });
    const edges = res?.data?.products?.edges || [];
    for (const edge of edges) {
      const node = edge.node;
      const variant = node.variants?.edges?.[0]?.node || {};
      const metafields = mapMetafields(node.metafields?.edges);
      const condition = metafields.condition || "";
      const typeValue =
        metafields.type ||
        (condition && ["Ungraded", "Damaged"].includes(condition) ? "Singles" : condition ? "Slabs" : "");
      results.push({
        id: node.id,
        title: node.title,
        vendor: node.vendor,
        handle: node.handle,
        tags: node.tags || [],
        condition,
        type: typeValue,
        game: metafields.game || "",
        expansion: metafields.expansion || "",
        language: metafields.language || "",
        sourceUrl: metafields.source_url || "",
        pricechartingValue: metafields.value || "",
        barcode: variant.barcode || "",
        price: variant.price || "",
        inventoryQuantity: variant.inventoryQuantity ?? null,
        variantId: variant.id || "",
        inventoryItemId: variant.inventoryItem?.id || "",
      });
      cursor = edge.cursor;
      if (typeof progressCb === "function") {
        progressCb(results.length);
      }
    }
    const pageInfo = res?.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  return results;
}
