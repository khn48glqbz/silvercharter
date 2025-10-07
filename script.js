#!/usr/bin/env node
import inquirer from "inquirer";
import dotenv from "dotenv";

dotenv.config();

// --- Main Menu ---
async function mainMenu() {
  while (true) {
    console.clear();
    console.log("=== Silvermine CLI ===\n");

    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: "Select an option:",
        choices: [
          "Import Cards",
          "Settings",
          new inquirer.Separator(),
          "Exit",
        ],
      },
    ]);

    switch (choice) {
      case "Import Cards":
        await importCardsMenu();
        break;
      case "Settings":
        await settingsMenu();
        break;
      case "Exit":
        console.log("\nGoodbye 👋");
        process.exit(0);
    }
  }
}

// --- Import Cards Menu ---
async function importCardsMenu() {
  console.clear();
  console.log("=== Import Cards ===\n");

  const { url } = await inquirer.prompt([
    {
      type: "input",
      name: "url",
      message: "Enter the PriceCharting (or other) URL to import:",
      validate: (input) => {
        if (!input) return "Please enter a URL.";
        if (!input.startsWith("http")) return "URL must start with http or https.";
        return true;
      },
    },
  ]);

  console.log(`\n🔍 Scanning URL: ${url}`);
  console.log("Fetching and processing data... (not implemented yet)");

  // Placeholder — will later call the scraper logic
  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log("\n✅ Import complete!");
  await pause();
}

// --- Settings Menu ---
async function settingsMenu() {
  console.clear();
  console.log("=== Settings ===\n");

  const { settingChoice } = await inquirer.prompt([
    {
      type: "list",
      name: "settingChoice",
      message: "Select a setting to modify:",
      choices: [
        "View Current Config",
        "Change Shopify Domain",
        "Return",
      ],
    },
  ]);

  switch (settingChoice) {
    case "View Current Config":
      console.log("\nCurrent Shopify Config:");
      console.log(`- Domain: ${process.env.SHOPIFY_DOMAIN}`);
      console.log(`- API Key: ${process.env.SHOPIFY_API_KEY ? "[Hidden]" : "Not Set"}`);
      console.log(`- Admin Token: ${process.env.SHOPIFY_ADMIN_TOKEN ? "[Hidden]" : "Not Set"}`);
      await pause();
      break;

    case "Change Shopify Domain":
      const { newDomain } = await inquirer.prompt([
        {
          type: "input",
          name: "newDomain",
          message: "Enter your new Shopify domain:",
        },
      ]);
      console.log(`\nUpdated domain to: ${newDomain} (not saved yet — we'll handle saving later)`);
      await pause();
      break;

    case "Return":
      return;
  }

  await settingsMenu();
}

// --- Helper ---
async function pause() {
  await inquirer.prompt([
    { type: "input", name: "pause", message: "Press Enter to return..." },
  ]);
}

// --- Start the CLI ---
mainMenu();
