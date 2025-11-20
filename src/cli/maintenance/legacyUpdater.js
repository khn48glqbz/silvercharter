// TEMP MODULE: remove after legacy metadata refresh is complete.
import inquirer from "inquirer";
import scrapeCard from "../../scraper/scrapeCard.js";
import { graphqlPost } from "../../shopify/graphql.js";
import { setProductMetafields } from "../../shopify/metafields.js";
import { ensureExpansionIconFile } from "../../shopify/files.js";
import { convertUSD } from "../../utils/currency.js";

const PRODUCTS_QUERY = `
  query ($cursor: String) {
    products(first: 50, after: $cursor, query: "metafields.pricecharting.source_url:*") {
      edges {
        cursor
        node {
          id
          title
          handle
          vendor
          productType
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
          variants(first: 1) {
            edges {
              node {
                id
                barcode
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id handle vendor productType }
      userErrors { field message }
    }
  }
`;

const singlesConditions = new Set(["Ungraded", "Damaged"]);

function mapMetafields(edges = []) {
  const out = {};
  for (const edge of edges || []) {
    out[edge.node.key] = {
      value: edge.node.value,
      type: edge.node.type,
      reference: edge.node.reference || null,
    };
  }
  return out;
}

async function* fetchProductsWithSourceUrl() {
  let cursor = null;
  while (true) {
    const res = await graphqlPost({ query: PRODUCTS_QUERY, variables: { cursor } });
    const edges = res?.data?.products?.edges || [];
    for (const edge of edges) {
      yield edge.node;
    }
    const pageInfo = res?.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
}

async function updateProductCoreFields(input) {
  const res = await graphqlPost({ query: PRODUCT_UPDATE_MUTATION, variables: { input } });
  const errors = res?.data?.productUpdate?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return res?.data?.productUpdate?.product;
}

export default async function runLegacyUpdater(config) {
  const { confirmRun } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmRun",
      message:
        "Legacy updater will rescrape every product and update metadata (no price/barcode changes). Continue?",
      default: false,
    },
  ]);

  if (!confirmRun) {
    console.log("Legacy updater cancelled.");
    return;
  }

  const targetCurrency = (config?.currency || "USD").toUpperCase();

  let processed = 0;
  let updatedProducts = 0;
  let updatedMetafields = 0;
  let skipped = 0;

  for await (const node of fetchProductsWithSourceUrl()) {
    processed += 1;
    const metafields = mapMetafields(node.metafields?.edges);
    const sourceUrl = metafields.source_url?.value;
    if (!sourceUrl) {
      skipped += 1;
      continue;
    }

    const variant = node.variants?.edges?.[0]?.node;
    const barcode = String(variant?.barcode || "").trim();
    if (!barcode) {
      console.warn(`Skipping ${node.title} — no barcode found.`);
      skipped += 1;
      continue;
    }

    const condition = metafields.condition?.value || "Ungraded";
    const typeValue = isSigned || singlesConditions.has(condition) ? "Singles" : "Slabs";

    let scraped;
    try {
      scraped = await scrapeCard(sourceUrl);
    } catch (err) {
      console.warn(`Failed to scrape ${node.title}:`, err.message || err);
      skipped += 1;
      continue;
    }

    const metadata = scraped?.metadata || {};
    const desiredHandle = barcode;
    const desiredVendor = metadata.vendor || node.vendor || "Unknown Vendor";
    const desiredProductType = "Trading Card";

    const updateInput = { id: node.id };
    let needsUpdate = false;

    if (desiredHandle && node.handle !== desiredHandle) {
      updateInput.handle = desiredHandle;
      needsUpdate = true;
    }
    if (node.vendor !== desiredVendor) {
      updateInput.vendor = desiredVendor;
      needsUpdate = true;
    }
    if (node.productType !== desiredProductType) {
      updateInput.productType = desiredProductType;
      needsUpdate = true;
    }

    if (needsUpdate) {
      try {
        await updateProductCoreFields(updateInput);
        updatedProducts += 1;
      } catch (err) {
        console.warn(`Product update failed for ${node.title}:`, err.message || err);
      }
    }

    const languageCode = metadata.languageCode || metafields.language?.value || "EN";
    const expansion = metadata.expansion || metafields.expansion?.value || "Unknown Expansion";
    const game = metadata.game || metafields.game?.value || "Unknown Game";
    const existingIconId = metafields.expansion_icon?.reference?.id || "";
    let expansionIconId = existingIconId;
    if (metadata.icon) {
      const ensured = await ensureExpansionIconFile(metadata.icon);
      if (ensured?.id) expansionIconId = ensured.id;
    }
    const isSigned = (metafields.signature?.value || "").toLowerCase() === "true";

    let originalValue = metafields.value?.value || "N/A";
    if (typeof scraped.price === "number" && !Number.isNaN(scraped.price)) {
      try {
        const converted = await convertUSD(scraped.price, targetCurrency);
        originalValue = Number(Number(converted).toFixed(2)).toFixed(2);
      } catch (err) {
        console.warn(`Failed to convert base price for ${node.title}:`, err.message || err);
      }
    }

    try {
      await setProductMetafields(node.id, {
        sourceUrl,
        condition,
        game,
        expansion,
        language: languageCode,
        type: typeValue,
        expansionIconId,
        value: originalValue,
        signature: isSigned,
      });
      updatedMetafields += 1;
      console.log(`Refreshed metadata for ${node.title} (${condition})`);
    } catch (err) {
      console.warn(`Metafield update failed for ${node.title}:`, err.message || err);
    }
  }

  console.log(
    `Legacy update complete. Processed: ${processed}, product updates: ${updatedProducts}, metafield refreshes: ${updatedMetafields}, skipped: ${skipped}.`
  );
}
