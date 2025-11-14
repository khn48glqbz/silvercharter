import path from "path";
import inquirer from "inquirer";
import labelsMenu from "../menus/labelsMenu.js";

export default async function runRepricingSession(_config, csvPath) {
  console.log(`Repricing session file: ${path.basename(csvPath)}`);
  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Repricing Session",
        choices: [
          "View Session Info",
          "Open Labels Menu",
          "Return to Products Menu",
        ],
      },
    ]);

    if (action === "View Session Info") {
      console.log(`Session CSV: ${csvPath}`);
      console.log("Repricing actions will be added soon.");
    } else if (action === "Open Labels Menu") {
      await labelsMenu(csvPath);
    } else if (action === "Return to Products Menu") {
      break;
    }
  }
}
