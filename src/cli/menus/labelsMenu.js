import inquirer from "inquirer";
import fs from "fs";
import open from "open";

export default async function labelsMenu(csvPath) {
  const labelsDir = csvPath.split("/").slice(0, -1).join("/");

  while (true) {
    const { labelChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "labelChoice",
        message: "Labels Menu",
        prefix: "⛏",
        choices: [
          "Preview CSV",
          "View Labels Directory",
          "Open CSV Externally",
          "Configure CSV Format",
          "Return",
        ],
      },
    ]);

    if (labelChoice === "Preview CSV") {
      if (fs.existsSync(csvPath)) console.log(fs.readFileSync(csvPath, "utf8"));
      else console.log("No CSV found for this session.");
    } else if (labelChoice === "View Labels Directory") {
      console.log(`Labels Directory: ${labelsDir}`);
    } else if (labelChoice === "Open CSV Externally") {
      if (fs.existsSync(csvPath)) await open(csvPath);
      else console.log("No CSV found to open.");
    } else if (labelChoice === "Configure CSV Format") {
      console.log("⚙ CSV format configuration not yet implemented.");
    } else if (labelChoice === "Return") {
      break;
    }
  }
}
