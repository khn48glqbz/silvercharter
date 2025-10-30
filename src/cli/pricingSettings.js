// src/cli/pricingSettings.js
import inquirer from "inquirer";
import { calculateFinalPrice } from "../utils/pricing.js";
import { saveConfig } from "../utils/config.js";

export default async function pricingSettingsMenu(config) {
  // ensure config.formula exists so menu logic is simpler
  if (!config.formula || typeof config.formula !== "object") config.formula = {};

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
      // Build choices from config.formula keys (exclude roundTo99)
      const conditionChoices = Object.keys(config.formula || {}).filter(k => k !== "roundTo99");

      // Offer an "Add new condition" option too
      conditionChoices.push(new inquirer.Separator());
      conditionChoices.push("Add new condition");
      conditionChoices.push("Cancel");

      const { condition } = await inquirer.prompt([
        {
          type: "list",
          name: "condition",
          message: "Select a condition to edit:",
          choices: conditionChoices,
        },
      ]);

      if (condition === "Add new condition") {
        const { newCondition, newExpr } = await inquirer.prompt([
          { name: "newCondition", message: "Name of new condition (e.g. Grade 11):" },
          { name: "newExpr", message: "Formula for new condition (e.g. *1.8):" },
        ]);
        config.formula[newCondition] = newExpr;
        saveConfig(config);
        console.log(`Added ${newCondition} -> ${newExpr}`);
      } else if (condition === "Cancel") {
        // nothing
      } else {
        const { newExpr } = await inquirer.prompt([
          { name: "newExpr", message: `New formula for "${condition}" (current: ${config.formula[condition]}):`, default: config.formula[condition] || "*1" },
        ]);
        config.formula[condition] = newExpr;
        saveConfig(config);
        console.log(`Updated ${condition} to ${newExpr}`);
      }
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
      // list available conditions (exclude roundTo99)
      const conditions = Object.keys(config.formula || {}).filter(k => k !== "roundTo99");
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
      const { final, usedFormula, roundTo99 } = await calculateFinalPrice(usdValue, config, selectedCondition);

      console.log(`\nPreview for "${selectedCondition}":`);
      console.log(`  Formula used: ${usedFormula}`);
      console.log(`  .99 rounding enabled (global flag): ${roundTo99}`);
      console.log(`  Retail price: ${config.currency} ${final.toFixed(2)}\n`);
    }

    else if (choice === "Return") break;
  }
}
