import inquirer from "inquirer";
import importMenu from "./imports-menu.js";
import productsMenu from "./products-menu.js";
import settingsMenu from "./settings-menu.js";

export default async function mainMenu(config) {

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
