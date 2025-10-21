import inquirer from "inquirer";
import shopifySettings from "./shopifySettings.js";
import pricingSettings from "./pricingSettings.js";
import { restoreDefaults } from "../utils/config.js";

export default async function settingsMenu(config) {
  while (true) {
    const { settingsChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "settingsChoice",
        message: "Settings",
        prefix: "⛏",
        choices: [
          "Shopify Settings",
          "Pricing Settings",
          "Restore Default Settings",
          "Return",
        ],
      },
    ]);

    if (settingsChoice === "Shopify Settings") {
      await shopifySettings(config);
    } else if (settingsChoice === "Pricing Settings") {
      await pricingSettings(config);
    } else if (settingsChoice === "Restore Default Settings") {
      restoreDefaults();
    } else if (settingsChoice === "Return") {
      break;
    }
  }
}
