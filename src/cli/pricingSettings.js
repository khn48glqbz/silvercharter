// src/cli/pricingSettings.js
import inquirer from "inquirer";
import { calculateFinalPrice } from "../utils/pricing.js";
import { saveConfig } from "../utils/config.js";

export default async function pricingSettingsMenu(config) {
  while (true) {
    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: `Pricing Settings (roundTo99: ${!!config?.pricing?.roundTo99})`,
        choices: [
          "Set Currency",
          "Edit Formula",
          "Toggle .99 Rounding",
          "Preview Calculation",
          "Return",
        ],
        prefix: "⛏",
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
      config.currency = newCurrency;
      saveConfig(config);
      console.log(`Currency updated to ${newCurrency}`);
    }

    else if (choice === "Edit Formula") {
      const { newFormula } = await inquirer.prompt([
        {
          name: "newFormula",
          message: "Enter new pricing formula (e.g. *1.2+3 or 1.2+3):",
          default: (config.pricing && config.pricing.formula) || config.pricingFormula || "*1.2",
        },
      ]);
      // store in canonical place:
      if (!config.pricing) config.pricing = {};
      config.pricing.formula = newFormula;
      // also keep legacy key if used elsewhere
      config.pricingFormula = newFormula;
      saveConfig(config);
      console.log(`Pricing formula updated to ${newFormula}`);
    }

    else if (choice === "Toggle .99 Rounding") {
      if (!config.pricing) config.pricing = {};
      config.pricing.roundTo99 = !config.pricing.roundTo99;
      saveConfig(config);
      console.log(`.99 rounding is now ${config.pricing.roundTo99 ? "ENABLED" : "DISABLED"}.`);
    }

    else if (choice === "Preview Calculation") {
      const { basePrice } = await inquirer.prompt([
        { name: "basePrice", message: "Enter base price (USD):", validate: v => !isNaN(v) && v > 0 },
      ]);

      const usdValue = parseFloat(basePrice);
      const { final } = await calculateFinalPrice(usdValue, config);

      console.log(`Retail price: ${config.currency} ${final.toFixed(2)}\n`);
    }

    else if (choice === "Return") {
      break;
    }
  }
}
