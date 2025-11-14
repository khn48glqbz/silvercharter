import inquirer from "inquirer";
import { loadConfig } from "../../utils/config.js";
import importMenu from "./importsMenu.js";
import productsMenu from "./productsMenu.js";
import settingsMenu from "./settingsMenu.js";

export default async function mainMenu() {
  const config = loadConfig();

  while (true) {
    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: "Main Menu",
        prefix: "⛏",
        choices: ["Imports", "Products", "Settings", "Exit"],
      },
    ]);

    if (choice === "Imports") {
      await importMenu(config);
    } else if (choice === "Products") {
      await productsMenu(config);
    } else if (choice === "Settings") {
      await settingsMenu(config);
    } else if (choice === "Exit") {
      console.log("Goodbye!");
      process.exit(0);
    }
  }
}
