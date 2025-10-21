import inquirer from "inquirer";

export default async function pricingSettings(config) {
  while (true) {
    const { pricingChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "pricingChoice",
        message: "Pricing Settings",
        prefix: "⛏",
        choices: [
          "Set Currency",
          "Edit Formula",
          "Preview Calculation",
          "Return",
        ],
      },
    ]);

    if (pricingChoice === "Set Currency") {
      const { currency } = await inquirer.prompt([{ name: "currency", message: "Enter currency code (e.g. GBP, USD):" }]);
      config.currency = currency;
      console.log(`Currency set to ${currency}`);
    } else if (pricingChoice === "Edit Formula") {
      const { formula } = await inquirer.prompt([{ name: "formula", message: "Enter pricing formula (e.g. *1.2):" }]);
      config.pricing = config.pricing || {};
      config.pricing.formula = formula;
      console.log(`Formula updated: ${formula}`);
    } else if (pricingChoice === "Preview Calculation") {
      const { price } = await inquirer.prompt([{ name: "price", message: "Enter base price (USD):" }]);
      const base = parseFloat(price);
      const result = base * parseFloat(config.pricing?.formula?.replace("*", "") || 1);
      console.log(`Result: ${config.currency || "GBP"} ${result.toFixed(2)}`);
    } else if (pricingChoice === "Return") break;
  }
}
