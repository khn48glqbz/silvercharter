import inquirer from "inquirer";
import scrapeCard from "../scraper/scrapeCard.js";
import { calculateFinalPrice } from "../utils/pricing.js";
import createDraftAndPublishToPos from "../shopify/draft.js";
import { appendCsvRows } from "../utils/csv.js";

export default async function importMenu(config, csvPath) {
  while (true) {
    const { importChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "importChoice",
        message: "Import Cards",
        prefix: "⛏",
        choices: [
          "Start Import",
          "View Syntax",
          "Return",
        ],
      },
    ]);

    if (importChoice === "Start Import") {
      const { typeChoice } = await inquirer.prompt([
        {
          type: "list",
          name: "typeChoice",
          message: "Select Import Type",
          prefix: "⛏",
          choices: ["Graded", "Ungraded", "Return"],
        },
      ]);
      if (typeChoice === "Return") continue;

      while (true) {
        const { urlInput } = await inquirer.prompt([
          { name: "urlInput", message: 'Enter card URL (add *N for quantity, "return" to go back, "exit" to quit):' },
        ]);
        const raw = (urlInput || "").trim();
        if (!raw) continue;
        const lower = raw.toLowerCase();
        if (lower === "return") break;
        if (lower === "exit") {
          console.log("Session finished. CSV saved to:", csvPath);
          process.exit(0);
        }

        let url = raw;
        let qty = 1;
        const m = url.match(/\*(\d+)$/);
        if (m) {
          qty = parseInt(m[1], 10) || 1;
          url = url.slice(0, m.index);
        }

        try {
          await handleImportUrl(url, qty, config, csvPath);
        } catch (err) {
          console.error("Error importing card:", err.message || err);
        }
      }
    } else if (importChoice === "View Syntax") {
      console.log('\nSyntax Guide:\n• Use *N to import multiples (e.g. https://...*3)\n• Type "return" to go back\n• Type "exit" to quit\n');
    } else if (importChoice === "Return") {
      break;
    }
  }
}

async function handleImportUrl(url, quantity, config, csvPath) {
  const scraped = await scrapeCard(url);
  if (!scraped) {
    console.error(`Failed to scrape ${url}`);
    return;
  }

  const { name, price } = scraped;

  // Calculate full pricing (conversion, formula, rounding)
  const { final: finalPrice } = await calculateFinalPrice(price, config);
  const priceStr = `${config.currency || "GBP"} ${finalPrice.toFixed(2)}`;

  console.log(`Uploading ${name} (${quantity}x) — ${priceStr}`);

  try {
    const result = await createDraftAndPublishToPos(
      { title: name, price: finalPrice, quantity, sourceUrl: url },
      config
    );

    const barcode = result.barcode || "";
    appendCsvRows(csvPath, barcode, name, finalPrice.toFixed(2), "", "Singles", "Pokémon", quantity);

    if (result.updated) {
      console.log(`Updated inventory for ${name}`);
    } else if (result.isNewProduct) {
      console.log(`Created new product with metafield: ${name}`);
    } else {
      console.log(`Product created as draft (reason: unknown)`);
    }
  } catch (err) {
    console.error(`Import error: ${err.message || err}`);
  }
}
