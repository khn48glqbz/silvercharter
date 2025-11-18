import inquirer from "inquirer";
import createDraftAndPublishToPos from "../shopify/draft.js";
import { appendCsvRows } from "../utils/csv.js";
import { calculateFinalPrice } from "../utils/pricing.js";
import { findProductBySourceUrlAndCondition } from "../shopify/metafields.js";
import scrapeCard from "../scraper/scrapeCard.js";
import { ensureExpansionIconFile } from "../shopify/files.js";

const singlesConditions = new Set(["Ungraded", "Damaged"]);

export async function handleImportUrl(url, quantity, condition, config, csvPath, options = {}) {
  const {
    formulaOverride = null,
    applyFormula = true,
    languageOverride = null,
  } = options;
  let existingProduct = null;
  const collectionType = singlesConditions.has(condition) ? "Singles" : "Slabs";

  try {
    existingProduct = await findProductBySourceUrlAndCondition(url, condition);
  } catch (err) {
    console.warn("Shopify pre-check failed (continuing to scrape):", err.message);
  }

  if (existingProduct) {
    console.log(`Shopify listing already exists for ${existingProduct.title} (${condition}). Updating inventory...`);
    try {
      await createDraftAndPublishToPos(
        {
          title: existingProduct.title,
          price: existingProduct.price,
          quantity,
          sourceUrl: url,
          condition,
          barcode: existingProduct.barcode,
          vendor: existingProduct.vendor,
          game: existingProduct.game,
          expansion: existingProduct.expansion,
          language: existingProduct.language,
          collection: collectionType,
          value: existingProduct.value,
          expansionIconId: existingProduct.expansionIcon,
        },
        config
      );
    } catch (err) {
      console.warn(`Failed to update inventory for ${existingProduct.title}:`, err.message);
    }

    const csvGame = existingProduct.game || "Unknown Game";
    const csvExpansion = existingProduct.expansion || "Unknown Expansion";
    const csvLanguage = existingProduct.language || "EN";
    appendCsvRows(
      csvPath,
      existingProduct.barcode ?? "",
      existingProduct.title,
      csvGame,
      csvExpansion,
      csvLanguage,
      collectionType,
      condition,
      existingProduct.price.toFixed(2),
      quantity
    );
    console.log(`Updated inventory for ${existingProduct.title} (${condition})`);
    return;
  }

  const scraped = await scrapeCard(url);
  const metadata = scraped.metadata || {};
  const game = metadata.game || "Unknown Game";
  const expansion = metadata.expansion || "Unknown Expansion";
  let languageCode = metadata.languageCode || "EN";
  if (languageOverride) languageCode = languageOverride;
  const vendor = metadata.vendor || game;
  const expansionIconInfo = metadata.icon ? await ensureExpansionIconFile(metadata.icon) : null;
  const priceTable = scraped.prices || {};
  const userCurrency = (config?.currency || "USD").toUpperCase();
  const hasDedicatedPrice = Object.prototype.hasOwnProperty.call(priceTable, condition);

  let basePrice = null;
  if (condition === "Damaged") {
    basePrice = priceTable.Ungraded ?? scraped.price ?? null;
  } else if (hasDedicatedPrice) {
    basePrice = priceTable[condition];
  } else {
    basePrice = scraped.price;
  }

  const needsManual =
    basePrice == null ||
    Number.isNaN(basePrice) ||
    (hasDedicatedPrice && (priceTable[condition] == null || Number.isNaN(priceTable[condition])));

  let manualOverride = false;
  if (needsManual) {
    const { manualPrice } = await inquirer.prompt([
      {
        type: "input",
        name: "manualPrice",
        message: `No price found for ${scraped.name} (${condition}). Enter manual ${userCurrency} price:`,
        validate: (input) => (!isNaN(parseFloat(input)) && parseFloat(input) >= 0) || "Enter a valid non-negative number",
      },
    ]);
    basePrice = parseFloat(manualPrice);
    manualOverride = true;
  }

  let originalValueDisplay = "N/A";
  let finalPrice = null;

  let pricingResult = null;
  if (manualOverride || !applyFormula) {
    finalPrice = Number(Number(basePrice).toFixed(2));
  } else {
    pricingResult = await calculateFinalPrice(basePrice, config, condition, formulaOverride, applyFormula);
    originalValueDisplay = Number(Number(pricingResult.converted).toFixed(2)).toFixed(2);
    finalPrice = pricingResult.final;
  }
  if (!pricingResult) {
    originalValueDisplay = Number(Number(finalPrice).toFixed(2)).toFixed(2) || "null";
  }

  console.log(`Uploading ${scraped.name} (${quantity}x, ${condition}) — ${config.currency || "GBP"} ${finalPrice.toFixed(2)}`);

  const result = await createDraftAndPublishToPos(
    {
      title: scraped.name,
      price: finalPrice,
      quantity,
      sourceUrl: url,
      condition,
      barcode: scraped.barcode ?? "",
      vendor,
      game,
      expansion,
      language: languageCode,
      collection: collectionType,
      value: originalValueDisplay,
      expansionIconId: expansionIconInfo?.id || null,
    },
    config
  );

  appendCsvRows(
    csvPath,
    result?.variants?.[0]?.barcode ?? scraped.barcode ?? "",
    scraped.name,
    game,
    expansion,
    languageCode,
    collectionType,
    condition,
    finalPrice.toFixed(2),
    quantity
  );

  console.log(`Created new product with metafields: ${scraped.name} (${condition})`);
}
