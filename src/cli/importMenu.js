import inquirer from "inquirer";
import scrapeCard from "../scraper/scrapeCard.js";
import { calculateFinalPrice, getFormulaForCondition } from "../utils/pricing.js";
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

async function handleImportUrl(url, quantity, condition, formula, config, csvPath) {
  // Use dummy scrape if grading logic not implemented yet
  const scraped = await scrapeCard(url).catch(() => null) || { name: "Unknown Card", price: 10.0 };

  const { name, price } = scraped;

  const { final: finalPrice } = await calculateFinalPrice(price, config, condition);
  const priceStr = `${config.currency || "GBP"} ${finalPrice.toFixed(2)}`;

  console.log(`Uploading ${name} (${quantity}x, ${condition}) — ${priceStr}`);

  try {
    // pass condition through to Shopify create/update
    const result = await createDraftAndPublishToPos(
      { title: name, price: finalPrice, quantity, sourceUrl: url, condition },
      config
    );

    const barcode = result.barcode || "";
    // append condition (previously called grade) to CSV
    appendCsvRows(csvPath, barcode, name, finalPrice.toFixed(2), condition, "Singles", "Pokemon", quantity);

    if (result.updated) {
      console.log(`Updated inventory for ${name} (${condition})`);
    } else if (result.isNewProduct) {
      console.log(`Created new product with metafields: ${name} (${condition})`);
    } else {
      console.log(`Product created as draft (reason: unknown)`);
    }
  } catch (err) {
    console.error(`Import error: ${err.message || err}`);
  }
}
