// src/cli/pricingSettings.js
import inquirer from "inquirer";
import { calculateFinalPrice } from "../utils/pricing.js";
import { saveConfig } from "../utils/config.js";

export default async function pricingSettingsMenu(config) {
  while (true) {
    const roundStatus =
      config?.formula?.roundTo99 === true ? "ENABLED" : "DISABLED";

    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: `Pricing Settings (.99 rounding: ${roundStatus})`,
        prefix: "⛏",
        choices: [
          "Set Currency",
          "Edit Condition Multipliers",
          "Toggle .99 Rounding",
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
      console.log("\nCurrent formula multipliers:");
      for (const [cond, expr] of Object.entries(config.formula || {})) {
        if (cond !== "roundTo99") console.log(`- ${cond}: ${expr}`);
      }

      const { condition, newExpr } = await inquirer.prompt([
        { name: "condition", message: "Condition name (e.g. Grade 9):" },
        { name: "newExpr", message: "New formula (e.g. *1.8):" },
      ]);

      if (!config.formula) config.formula = {};
      config.formula[condition] = newExpr;
      saveConfig(config);
      console.log(`Updated ${condition} to ${newExpr}`);
    }

    else if (choice === "Toggle .99 Rounding") {
      if (!config.formula) config.formula = {};
      config.formula.roundTo99 = !config.formula.roundTo99;
      saveConfig(config);
      console.log(
        `.99 rounding is now ${config.formula.roundTo99 ? "ENABLED" : "DISABLED"}.`
      );
    }

    else if (choice === "Preview Calculation") {
      const { basePrice } = await inquirer.prompt([
        {
          name: "basePrice",
          message: "Enter base price (USD):",
          validate: (v) => !isNaN(v) && v > 0,
        },
      ]);

      const usdValue = parseFloat(basePrice);
      const { final } = await calculateFinalPrice(usdValue, config);
      console.log(`Retail price: ${config.currency} ${final.toFixed(2)}\n`);
    }

    else if (choice === "Return") break;
  }
}
