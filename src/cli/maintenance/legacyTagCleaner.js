// TEMP MODULE: removes legacy tags from products with PriceCharting source URLs.
import inquirer from "inquirer";
import { graphqlPost } from "../../shopify/graphql.js";

const TAG_QUERY = `
  query ($cursor: String) {
    products(first: 50, after: $cursor, query: "metafields.pricecharting.source_url:*") {
      edges {
        cursor
        node {
          id
          title
          tags
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title tags }
      userErrors { field message }
    }
  }
`;

async function* fetchProducts() {
  let cursor = null;
  while (true) {
    const res = await graphqlPost({ query: TAG_QUERY, variables: { cursor } });
    const edges = res?.data?.products?.edges || [];
    for (const edge of edges) {
      yield edge.node;
    }
    const pageInfo = res?.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
}

export default async function runLegacyTagCleaner() {
  const { confirmRun } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmRun",
      message: "Remove ALL tags from products with PriceCharting source URLs? (This cannot be undone)",
      default: false,
    },
  ]);

  if (!confirmRun) {
    console.log("Tag cleanup cancelled.");
    return;
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for await (const product of fetchProducts()) {
    processed += 1;
    const tags = Array.isArray(product.tags) ? product.tags : [];
    if (!tags.length) {
      skipped += 1;
      continue;
    }

    try {
      const input = { id: product.id, tags: [] };
      const res = await graphqlPost({ query: PRODUCT_UPDATE_MUTATION, variables: { input } });
      const errors = res?.data?.productUpdate?.userErrors;
      if (errors?.length) {
        console.warn(`Failed to clear tags for ${product.title}:`, errors.map((e) => e.message).join("; "));
        skipped += 1;
        continue;
      }
      updated += 1;
      console.log(`Cleared ${tags.length} tag(s) from ${product.title}`);
    } catch (err) {
      console.warn(`Error clearing tags for ${product.title}:`, err.message || err);
      skipped += 1;
    }
  }

  console.log(`Tag cleanup complete. Processed: ${processed}, cleaned: ${updated}, unchanged: ${skipped}.`);
}
