import inquirer from "inquirer";
import { loadConfig, getAndIncrementSessionId } from "../utils/config.js";
import { createSessionCSVWithId } from "../utils/csv.js";
import importMenu from "./importMenu.js";
import labelsMenu from "./labelsMenu.js";
import settingsMenu from "./settingsMenu.js";

export default async function mainMenu() {
  const config = loadConfig();
  const sessionId = getAndIncrementSessionId();
  const csvPath = createSessionCSVWithId(sessionId);

  console.log(`Session ID: ${sessionId}`);

  while (true) {
    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: "Main Menu",
        prefix: "⛏",
        choices: ["Imports", "Labels", "Settings", "Exit"],
      },
    ]);

    if (choice === "Imports") {
      await importMenu(config, csvPath);
    } else if (choice === "Labels") {
      await labelsMenu(csvPath);
    } else if (choice === "Settings") {
      await settingsMenu(config);
    } else if (choice === "Exit") {
      console.log("Exiting — session CSV:", csvPath);
      process.exit(0);
    }
  }
}
