import path from "path";
import inquirer from "inquirer";
import { getAndIncrementSessionId } from "../../utils/config.js";
import { createSessionCSVWithId, listSessionFiles } from "../../utils/csv.js";
import runRepricingSession from "../sessions/repricingSession.js";
import viewProducts from "../products/viewProducts.js";

export default async function productsMenu(config) {
  while (true) {
    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: "Products",
        prefix: "🛠",
        choices: ["View Products", "Start Repricing Session", "Continue Repricing Session", "Return"],
      },
    ]);

    if (choice === "View Products") {
      await viewProducts(config);
    } else if (choice === "Start Repricing Session") {
      const sessionId = getAndIncrementSessionId();
      const csvPath = createSessionCSVWithId(sessionId, "repricing");
      console.log(`Started new repricing session: ${path.basename(csvPath)}`);
      await runRepricingSession(config, csvPath);
    } else if (choice === "Continue Repricing Session") {
      const sessions = listSessionFiles("repricing");
      if (!sessions.length) {
        console.log("No repricing sessions found. Start a new session first.");
        continue;
      }
      const { selected } = await inquirer.prompt([
        {
          type: "list",
          name: "selected",
          message: "Select repricing session",
          choices: [...sessions.map((s) => s.name), "Return"],
        },
      ]);
      if (selected === "Return") continue;
      const found = sessions.find((s) => s.name === selected);
      if (!found) {
        console.warn("Selected session not found.");
        continue;
      }
      await runRepricingSession(config, found.path);
    } else if (choice === "Return") {
      break;
    }
  }
}

// Actual repricing workflow lives in src/cli/sessions/repricingSession.js
