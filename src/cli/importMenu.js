// src/cli/importMenu.js
import inquirer from "inquirer";
import { calculateFinalPrice, getFormulaForCondition } from "../utils/pricing.js";
import createDraftAndPublishToPos from "../shopify/draft.js";
import { appendCsvRows } from "../utils/csv.js";
import { findProductBySourceUrlAndCondition } from "../shopify/metafields.js";
import scrapeCard from "../scraper/scrapeCard.js";

export default async function importMenu(config, csvPath) {
  while (true) {
    const { importChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "importChoice",
        message: "Import Cards",
        prefix: "⛏",
        choices: ["Start Import", "View Syntax", "Return"],
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
        const { switches } = await inquirer.prompt([
          {
            name: "switches",
            message: 'Enter additional switches (e.g. "U*2", "G9.5*3", "D*1") — leave blank for default (U*1):',
            default: "U*1",
          },
        ]);

        // Parse switch
        const switchMatch = switches.match(/^([A-Za-z0-9.]+)\*(\d+)$/);
        let conditionCode = "U";
        let quantity = 1;

        if (switchMatch) {
          conditionCode = switchMatch[1];
          quantity = parseInt(switchMatch[2], 10) || 1;
        }

        // Map condition codes to config formula keys
        const conditionMap = {
          U: "Ungraded",
          D: "Damaged",
          G7: "Grade 7",
          G8: "Grade 8",
          G9: "Grade 9",
          "G9.5": "Grade 9.5",
          G10: "Grade 10",
        };

        const condition = conditionMap[conditionCode] || conditionCode;
        const formula = getFormulaForCondition(condition, config);

        try {
          if (!/^https?:\/\//i.test(url)) {
            console.error("Invalid URL format. Please enter a full http/https link.");
            continue;
          }
          await handleImportUrl(url, quantity, condition, formula, config, csvPath);
        } catch (err) {
          console.error("Error importing card:", err.message || err);
        }
      }

    } else if (importChoice === "View Syntax") {
      console.log(`
Syntax Guide:
  URL only: imports a single ungraded card
  URL + switches:
    U*5   → 5 ungraded cards
    D*3   → 3 damaged cards
    G9.5*2 → 2 graded 9.5 cards

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
        },
        config
      );
    } catch (err) {
      console.warn(`Failed to update inventory for ${existingProduct.title}:`, err.message);
    }

    appendCsvRows(csvPath, existingProduct.barcode ?? "", existingProduct.title, existingProduct.price.toFixed(2), condition, "Singles", "Pokemon", quantity);
    console.log(`Updated inventory for ${existingProduct.title} (${condition})`);
    return;
  }

  // Scrape PriceCharting if product not found
  const scraped = await scrapeCard(url);
  let basePrice = scraped.price;
  let applyFormula = true;

  if (basePrice == null || isNaN(basePrice)) {
    const { manualPrice } = await inquirer.prompt([
      {
        type: "input",
        name: "manualPrice",
        message: `No price found for ${scraped.name} (${condition}). Enter manual price:`,
        validate: (input) => (!isNaN(parseFloat(input)) && parseFloat(input) >= 0) || "Enter a valid non-negative number",
      },
    ]);
    basePrice = parseFloat(manualPrice);
    applyFormula = false;
  }

  const finalPrice = applyFormula
    ? (await calculateFinalPrice(basePrice, config, condition)).final
    : basePrice;

  console.log(`Uploading ${scraped.name} (${quantity}x, ${condition}) — ${config.currency || "GBP"} ${finalPrice.toFixed(2)}`);

  const result = await createDraftAndPublishToPos(
    {
      title: scraped.name,
      price: finalPrice,
      quantity,
      sourceUrl: url,
      condition,
      barcode: scraped.barcode ?? "",
    },
    config
  );

  appendCsvRows(csvPath, result?.variants?.[0]?.barcode ?? "", scraped.name, finalPrice.toFixed(2), condition, "Singles", "Pokemon", quantity);

  console.log(`Created new product with metafields: ${scraped.name} (${condition})`);
}
