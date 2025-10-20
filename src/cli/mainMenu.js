import inquirer from "inquirer";
import path from "path";

import { loadConfig } from "../utils/config.js";
import { getAndIncrementSessionId } from "../utils/config.js";
import { createSessionCSVWithId, appendCsvRows } from "../utils/csv.js";
import scrapeCard from "../scraper/scrapeCard.js";
import { convertFromUSD } from "../utils/currency.js";
import { applyPricingFormula } from "../utils/pricing.js";
import createDraftAndPublishToPos from "../shopify/draft.js";
import { getPosPublicationIdAuto } from "../shopify/inventory.js";
import settingsMenu from "./settingsMenu.js";

export default async function mainMenu() {
  const config = loadConfig();

  // create session using nextSessionId from config
  const sessionId = getAndIncrementSessionId();
  const csvPath = createSessionCSVWithId(sessionId);
  console.log(`Session CSV: ${csvPath}`);

  // Try to get POS publication id from env or auto-detect (not required)
  let posPublicationId = process.env.POS_PUBLICATION_ID || null;
  if (!posPublicationId) {
    try {
      posPublicationId = await getPosPublicationIdAuto();
      if (posPublicationId) console.log(`Detected POS publication id: ${posPublicationId}`);
    } catch (err) {
      // ignore
    }
  }

  while (true) {
    const { choice } = await inquirer.prompt([{ type: "list", name: "choice", message: "Main Menu", choices: ["Import cards", "Settings", "Exit"] }]);
    if (choice === "Import cards") {
      while (true) {
        const { urlInput } = await inquirer.prompt([{ name: "urlInput", message: 'Enter card URL (add *N for quantity, "return" to go back, "exit" to quit):' }]);
        const raw = (urlInput || "").trim();
        if (!raw) continue;
        const lower = raw.toLowerCase();
        if (lower === "return") break;
        if (lower === "exit") {
          console.log("Session finished. CSV saved to:", csvPath);
          process.exit(0);
        }

        // parse quantity suffix without lowercasing the URL
        let url = raw;
        let qty = 1;
        const m = url.match(/\*(\d+)$/);
        if (m) {
          qty = parseInt(m[1], 10) || 1;
          url = url.slice(0, m.index);
        }

        try {
          await handleImportUrl(url, qty, config, csvPath, posPublicationId);
        } catch (err) {
          console.error("Error importing card:", err.message || err);
        }
      }
    } else if (choice === "Settings") {
      await settingsMenu(config);
    } else if (choice === "Exit") {
      console.log("Exiting — session CSV:", csvPath);
      process.exit(0);
    }
  }
}

async function handleImportUrl(url, quantity, config, csvPath, posPublicationIdArg) {
  const scraped = await scrapeCard(url);
  if (!scraped) {
    console.error(`Failed to scrape ${url}`);
    return;
  }

  const { name, price } = scraped;
  const converted = await convertFromUSD(price, config);
  const finalPrice = applyPricingFormula(converted, config);

  const now = new Date();
  const dateOnly = now.toISOString().slice(0, 10);
  const priceStr = `${config.currency || "GBP"} ${finalPrice.toFixed(2)}`;
  appendCsvRows(csvPath, dateOnly, priceStr, name, "", quantity);

  console.log(`Uploading ${name} (${quantity}x) — ${priceStr}`);

  try {
    const result = await createDraftAndPublishToPos(
      { title: name, price: finalPrice, quantity, sourceUrl: url },
      config,
      posPublicationIdArg
    );

    if (result.updated) {
      console.log(`✔ Updated inventory for ${name}`);
    } else if (result.method === "created_with_metafield") {
      console.log(`✔ Created new product with metafield: ${name}`);
    } else {
      console.log(`⚠ Product created as draft (reason: ${result.reason || "unknown"})`);
    }
  } catch (err) {
    console.error(`Import error: ${err.message || err}`);
  }
}
