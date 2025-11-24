import inquirer from "inquirer";
import shopifySettings from "../flows/shopify-settings.js";
import pricingSettings from "../../app/pricing/pricing-settings.js";
import { restoreDefaults } from "../../app/config/settings.js";

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
      const restored = restoreDefaults();
      // Mutate the shared config object so the running session uses refreshed defaults
      Object.keys(config).forEach((key) => delete config[key]);
      Object.assign(config, restored);
      console.log("Settings restored to defaults.");
    } else if (settingsChoice === "Return") {
      break;
    }
  }
}
