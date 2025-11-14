// src/cli/importMenu.js
import inquirer from "inquirer";
import { calculateFinalPrice, getFormulaForCondition } from "../utils/pricing.js";
import createDraftAndPublishToPos from "../shopify/draft.js";
import { appendCsvRows } from "../utils/csv.js";
import { findProductBySourceUrlAndCondition } from "../shopify/metafields.js";
import scrapeCard from "../scraper/scrapeCard.js";
import runLegacyUpdater from "./legacyUpdater.js";
import runLegacyTagCleaner from "./legacyTagCleaner.js";
import { parseSwitchInput } from "./switchParser.js";
import { ensureExpansionIconFile } from "../shopify/files.js";

export default async function importMenu(config, csvPath) {
  let switchDefaults = { condition: "Ungraded", quantity: 1 };
  while (true) {
    const { importChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "importChoice",
        message: "Imports",
        prefix: "⛏",
        choices: ["Start Import", "Update Legacy Cards", "Remove Legacy Tags", "View Syntax", "Return"],
      },
    ]);

    if (importChoice === "Start Import") {
      while (true) {
        const { urlInput } = await inquirer.prompt([
          { name: "urlInput", message: 'Enter card URL ("return" to go back, "exit" to quit):' },
        ]);

        const rawUrl = (urlInput || "").trim();
        const lower = rawUrl.toLowerCase();
        if (!rawUrl) continue;
        if (lower === "return") break;
        if (lower === "exit") {
          console.log("Session finished. CSV saved to:", csvPath);
          process.exit(0);
        }

        // Clean query params from URL (anything after ?)
        const url = rawUrl.split("?")[0];

        // Check URL validity early
        if (!/^https?:\/\//i.test(url)) {
          console.error("Invalid URL format. Please enter a full http/https link.");
          continue;
        }

        // Ask for condition/quantity switches
        const defaultLabel = `${switchDefaults.condition} x${switchDefaults.quantity}`;
        const { switches } = await inquirer.prompt([
          {
            name: "switches",
            message: `Switches (current default: ${defaultLabel}). Use "-g/-G" for grade, "-q/-Q" for quantity, "-n" to queue another card:`,
            default: "",
          },
        ]);

        let parsed;
        try {
          parsed = parseSwitchInput(switches, switchDefaults);
        } catch (err) {
          console.error(err.message);
          continue;
        }

        switchDefaults = parsed.defaults;

        console.log("Pending imports:");
        parsed.entries.forEach((entry, idx) => {
          console.log(`  ${idx + 1}. ${entry.condition} x${entry.quantity}`);
        });

        const { confirmRun } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirmRun",
            message: "Proceed with these imports?",
            default: true,
          },
        ]);

        if (!confirmRun) {
          console.log("Import cancelled.");
          continue;
        }

        try {
          for (const entry of parsed.entries) {
            if (!/^https?:\/\//i.test(url)) {
              console.error("Invalid URL format. Please enter a full http/https link.");
              break;
            }
            const formula = getFormulaForCondition(entry.condition, config);
            await handleImportUrl(url, entry.quantity, entry.condition, formula, config, csvPath);
          }
        } catch (err) {
          console.error("Error importing card:", err.message || err);
        }
      }

    } else if (importChoice === "Update Legacy Cards") {
      await runLegacyUpdater(config);
    } else if (importChoice === "Remove Legacy Tags") {
      await runLegacyTagCleaner();
    } else if (importChoice === "View Syntax") {
      console.log(`
Syntax Guide:
  URL only + blank switches: uses current defaults (initially Ungraded x1)
  Switch Flags:
    -g9      → use Grade 9 for this import
    -q3      → quantity 3 for this import
    -G10     → set Grade 10 as the new default grade (uppercase = persistent)
    -Q2      → set quantity 2 as the new default quantity
    -n       → commit the current card and start defining another (batch in one line)

Type "return" to go back
Type "exit" to quit
`);
    } else if (importChoice === "Return") {
      break;
    }
  }
}

export async function handleImportUrl(url, quantity, condition, formula, config, csvPath) {
  let existingProduct = null;
  const singlesConditions = new Set(["Ungraded", "Damaged"]);
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

  // Scrape PriceCharting if product not found
  const scraped = await scrapeCard(url);
  const metadata = scraped.metadata || {};
  const game = metadata.game || "Unknown Game";
  const expansion = metadata.expansion || "Unknown Expansion";
  const languageCode = metadata.languageCode || "EN";
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

  const finalPrice = manualOverride
    ? Number(Number(basePrice).toFixed(2))
    : (await calculateFinalPrice(basePrice, config, condition)).final;

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
