import inquirer from "inquirer";
import { graphqlPost } from "../../adapters/shopify/client/graphql.js";
import { setProductMetafields } from "../../adapters/shopify/services/metafield-service.js";

const PRODUCTS_QUERY = `
  query ($cursor: String) {
    products(first: 50, after: $cursor, query: "metafields.pricecharting.source_url:*") {
      edges {
        cursor
        node {
          id
          title
          valueMeta: metafield(namespace: "pricecharting", key: "value") {
            value
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export default async function normalizeValueMetafields() {
  const { confirmRun } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmRun",
      message: "Normalize existing pricecharting.value metafields (replace '-' with \"null\")?",
      default: false,
    },
  ]);

  if (!confirmRun) {
    console.log("Normalization cancelled.");
    return;
  }

  let cursor = null;
  let updated = 0;
  let scanned = 0;
  while (true) {
    const res = await graphqlPost({ query: PRODUCTS_QUERY, variables: { cursor } });
    const edges = res?.data?.products?.edges || [];
    for (const edge of edges) {
      const node = edge.node;
      scanned += 1;
      const value = node.valueMeta?.value;
      const needsNormalize = value === "-" || value == null || String(value).trim() === "";
      if (needsNormalize) {
        try {
          await setProductMetafields(node.id, { value: "null" });
          updated += 1;
          console.log(`Normalized ${node.title}`);
        } catch (err) {
          console.warn(`Failed to update ${node.title}:`, err.message || err);
        }
      }
      cursor = edge.cursor;
    }
    const pageInfo = res?.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  console.log(`Normalization complete. Scanned ${scanned} product(s). Updated ${updated}.`);
}
