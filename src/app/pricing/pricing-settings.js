import inquirer from "inquirer";
import { calculateFinalPrice } from "./pricing-engine.js";
import { saveConfig } from "../config/settings.js";

export default async function pricingSettingsMenu(config) {
  // ensure config.formula exists so menu logic is simpler
  if (!config.formula || typeof config.formula !== "object") config.formula = {};

  while (true) {
    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: `Pricing Settings`,
        prefix: "⛏",
        choices: [
          "Set Currency",
          "Edit Condition Multipliers",
          "Preview Calculation",
          "Return",
        ],
      },
    ]);

    if (choice === "Set Currency") {
      const { newCurrency } = await inquirer.prompt([
        {
          name: "newCurrency",
          message: "Enter target currency code (e.g. GBP, EUR, CAD):",
          default: config.currency || "GBP",
        },
      ]);
      config.currency = newCurrency.trim().toUpperCase();
      saveConfig(config);
      console.log(`Currency updated to ${config.currency}`);
    }

    else if (choice === "Edit Condition Multipliers") {
      console.log("Condition formulas/rounding editor will be added later.");
    }

    else if (choice === "Preview Calculation") {
      // list available conditions (exclude roundingDefault)
      const conditions = Object.keys(config.formula || {}).filter(k => k !== "roundingDefault");
      if (conditions.length === 0) {
        console.log("No condition formulas defined in settings. Use 'Edit Condition Multipliers' to add some first.");
        continue;
      }

      const { selectedCondition } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedCondition",
          message: "Select a condition to preview:",
          choices: conditions,
        },
      ]);

      const { basePrice } = await inquirer.prompt([
        {
          name: "basePrice",
          message: "Enter base price (USD):",
          validate: (v) => !isNaN(v) && v > 0,
        },
      ]);

      const usdValue = parseFloat(basePrice);
      const { final, usedFormula, rounding } = await calculateFinalPrice(usdValue, config, selectedCondition);

      console.log(`\nPreview for "${selectedCondition}":`);
      console.log(`  Formula used: ${usedFormula}`);
      if (rounding) {
        console.log(`  Rounding: mode=${rounding.mode || "nearest"}, targets=${Array.isArray(rounding.targets) ? rounding.targets.join(",") : "n/a"}`);
      } else {
        console.log(`  Rounding: none`);
      }
      console.log(`  Retail price: ${config.currency} ${final.toFixed(2)}\n`);
    }

    else if (choice === "Return") break;
  }
}
