import path from "path";
import inquirer from "inquirer";
import { createSessionCSVWithId, listSessionFiles } from "../../utils/csv.js";
import { getAndIncrementSessionId } from "../../utils/config.js";
import runLegacyUpdater from "../maintenance/legacyUpdater.js";
import runLegacyTagCleaner from "../maintenance/legacyTagCleaner.js";
import runImportSession from "../sessions/importSession.js";

export default async function importMenu(config) {
  while (true) {
    const { importChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "importChoice",
        message: "Imports",
        prefix: "⛏",
        choices: [
          "Start Import Session",
          "Continue Import Session",
          "Update Legacy Cards",
          "Remove Legacy Tags",
          "View Syntax",
          "Return",
        ],
      },
    ]);

    if (importChoice === "Start Import Session") {
      const sessionId = getAndIncrementSessionId();
      const csvPath = createSessionCSVWithId(sessionId, "import");
      console.log(`Started new import session: ${path.basename(csvPath)}`);
      await runImportSession(config, csvPath);
    } else if (importChoice === "Continue Import Session") {
      const sessions = listSessionFiles("import");
      if (!sessions.length) {
        console.log("No import sessions found in labels/. Start a new session first.");
        continue;
      }
      const { selected } = await inquirer.prompt([
        {
          type: "list",
          name: "selected",
          message: "Select import session",
          choices: [...sessions.map((s) => s.name), "Return"],
        },
      ]);
      if (selected === "Return") continue;
      const found = sessions.find((s) => s.name === selected);
      if (!found) {
        console.warn("Selected session not found.");
        continue;
      }
      await runImportSession(config, found.path);
    } else if (importChoice === "Update Legacy Cards") {
      await runLegacyUpdater(config);
    } else if (importChoice === "Remove Legacy Tags") {
      await runLegacyTagCleaner();
    } else if (importChoice === "View Syntax") {
      console.log(`
Syntax Guide:
  URL only + blank switches: uses current defaults (initially Ungraded x1)
  Switch Flags:
    -g9      → use Grade 9 for this import
    -q3      → quantity 3 for this import
    -G10     → set Grade 10 as the new default grade (uppercase = persistent)
    -Q2      → set quantity 2 as the new default quantity
    -n       → commit the current card and start defining another (batch in one line)
  Special commands at the URL prompt:
    "labels" → open the Labels menu for the active session
    "return" → exit the current session
    "exit"   → quit the CLI entirely

Type "return" to go back
Type "exit" to quit
`);
    } else if (importChoice === "Return") {
      break;
    }
  }
}

// session logic moved to src/cli/sessions/importSession.js
