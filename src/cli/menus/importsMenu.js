import path from "path";
import inquirer from "inquirer";
import { createSessionCSVWithId, listSessionFiles } from "../../utils/csv.js";
import { getAndIncrementSessionId } from "../../utils/config.js";
import runLegacyUpdater from "../maintenance/legacyUpdater.js";
import runLegacyTagCleaner from "../maintenance/legacyTagCleaner.js";
import normalizeValueMetafields from "../maintenance/normalizeValues.js";
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
          "Normalize Value Metafields",
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
    } else if (importChoice === "Normalize Value Metafields") {
      await normalizeValueMetafields();
    } else if (importChoice === "View Syntax") {
      console.log(`
Syntax Guide:
  URL only + blank switches: uses current defaults (initially Ungraded x1)
  Switch Flags:
    -c U        → condition (Ungraded/Damaged/Grade e.g. "-c g9.5")
    -q 3        → quantity for this entry
    -l JP       → override language (code or name)
    -f 1.2      → use custom multiplier (or "-f off" to disable formula)
    -n          → commit the current card and start another
    -d          → make the current switches the new defaults
  Special commands at the URL prompt:
    "labels" → open the Labels menu for the active session
    "custom" → add a card by entering details manually
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
