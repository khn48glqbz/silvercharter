import inquirer from "inquirer";
import saveProduct from "../adapters/shopify/services/draft-service.js";
import { appendCsvRows } from "../shared/csv/csv-writer.js";
import { calculateFinalPrice } from "../app/pricing/pricing-engine.js";
import { findProductBySourceUrlAndCondition } from "../adapters/shopify/services/metafield-service.js";
import scrapeCard from "../adapters/scrapers/pricecharting.js";
import { ensureExpansionIconFile } from "../adapters/shopify/services/file-service.js";
import { formatFormulaForDisplay } from "../shared/util/format-formula.js";

const singlesConditions = new Set(["Ungraded", "Damaged"]);

export async function handleImportUrl(url, quantity, condition, config, csvPath, options = {}) {
  const {
    formulaOverride = null,
    applyFormula = true,
    languageOverride = null,
    signed = false,
  } = options;
  let existingProduct = null;
  const collectionType = singlesConditions.has(condition) ? "Singles" : "Slabs";

  try {
    existingProduct = await findProductBySourceUrlAndCondition(url, condition, { signed });
  } catch (err) {
    console.warn("Shopify pre-check failed (continuing to scrape):", err.message);
  }

  if (existingProduct) {
    console.log(`Shopify listing already exists for ${existingProduct.title} (${condition}). Updating inventory...`);
    try {
      await saveProduct({
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
        signed: existingProduct.signed,
        formula: formatFormulaForDisplay(existingProduct.formula || ""),
      });
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
  let vendor = (metadata.vendor || "").trim();
  if (!vendor) {
    const { manualVendor } = await inquirer.prompt([
      {
        name: "manualVendor",
        message: `Vendor not found for ${scraped.name}. Enter vendor/publisher:`,
        default: game,
        validate: (input) => !!input.trim() || "Vendor cannot be blank.",
      },
    ]);
    vendor = manualVendor.trim() || game;
  }
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
    signed ||
    basePrice == null ||
    Number.isNaN(basePrice) ||
    (hasDedicatedPrice && (priceTable[condition] == null || Number.isNaN(priceTable[condition])));

  let manualOverride = false;
  if (needsManual) {
    const { manualPrice } = await inquirer.prompt([
      {
        type: "input",
        name: "manualPrice",
        message: signed
          ? `Signed cards require manual pricing. Enter ${userCurrency} price:`
          : `No price found for ${scraped.name} (${condition}). Enter manual ${userCurrency} price:`,
        validate: (input) => (!isNaN(parseFloat(input)) && parseFloat(input) >= 0) || "Enter a valid non-negative number",
      },
    ]);
    basePrice = parseFloat(manualPrice);
    manualOverride = true;
  }

  let originalValueDisplay = "N/A";
  let finalPrice = null;
  let usedFormula = "";

  let pricingResult = null;
  if (manualOverride || !applyFormula) {
    finalPrice = Number(Number(basePrice).toFixed(2));
    usedFormula = "manual";
  } else {
    pricingResult = await calculateFinalPrice(basePrice, config, condition, formulaOverride, applyFormula);
    originalValueDisplay = Number(Number(pricingResult.converted).toFixed(2)).toFixed(2);
    finalPrice = pricingResult.final;
    usedFormula = pricingResult.usedFormula || formulaOverride || "*1";
  }
  if (signed) {
    originalValueDisplay = "null";
    usedFormula = "manual";
  } else if (!pricingResult) {
    originalValueDisplay = Number(Number(finalPrice).toFixed(2)).toFixed(2) || "null";
  }
  const formulaDisplay = formatFormulaForDisplay(usedFormula);

  const baseTitle = scraped.name
    .replace(/\[Signature\]/gi, "")
    .replace(/\(Signature\)/gi, "")
    .trim();
  const displayTitle = signed ? `${baseTitle} [Signature]` : baseTitle;
  console.log(`Uploading ${displayTitle} (${quantity}x, ${condition}) — ${config.currency || "GBP"} ${finalPrice.toFixed(2)}`);

  const attributes = signed ? ["Signature"] : [];
  const result = await saveProduct({
    title: displayTitle,
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
    signed,
    attributes,
    formula: formulaDisplay,
  });

  appendCsvRows(
    csvPath,
    result?.barcode ?? scraped.barcode ?? "",
    displayTitle,
    game,
    expansion,
    languageCode,
    collectionType,
    condition,
    finalPrice.toFixed(2),
    quantity
  );

  console.log(`Created new product with metafields: ${displayTitle} (${condition})`);
}
