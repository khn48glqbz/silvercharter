import path from "path";
import inquirer from "inquirer";
import labelsMenu from "../menus/labels-menu.js";
import { parseSwitchInput } from "../components/utils/switch-parser.js";
import { handleImportUrl } from "../../workflows/import-workflow.js";
import handleCustomCard from "../flows/custom-card.js";

export default async function runImportSession(config, csvPath) {
  console.log(`Using import session file: ${path.basename(csvPath)}`);
  let switchDefaults = {
    condition: "Ungraded",
    quantity: 1,
    language: null,
    applyFormula: true,
    formulaOverride: null,
    signed: false,
  };

  while (true) {
    const { urlInput } = await inquirer.prompt([
      { name: "urlInput", message: 'Enter card URL ("labels" for labels, "return" to go back, "exit" to quit):' },
    ]);

    const rawUrl = (urlInput || "").trim();
    const lower = rawUrl.toLowerCase();
    if (!rawUrl) continue;
    if (lower === "return") break;
    if (lower === "labels") {
      await labelsMenu(csvPath);
      continue;
    }
    if (lower === "custom") {
      await handleCustomCard(config, csvPath);
      continue;
    }
    if (lower === "exit") {
      console.log("Session finished. CSV saved to:", csvPath);
      process.exit(0);
    }

    const url = rawUrl.split("?")[0];

    if (!/^https?:\/\//i.test(url)) {
      console.error("Invalid URL format. Please enter a full http/https link.");
      continue;
    }

    const defaultParts = [
      `${switchDefaults.condition}`,
      `x${switchDefaults.quantity}`,
      switchDefaults.language ? `lang:${switchDefaults.language}` : null,
      switchDefaults.formulaOverride ? `f:${switchDefaults.formulaOverride}` : null,
      switchDefaults.applyFormula === false ? "formula:off" : null,
    ]
      .filter(Boolean)
      .join(" ");
    const { switches } = await inquirer.prompt([
      {
        name: "switches",
        message: `Switches (current default: ${defaultParts || "none"}). Use "-c" for condition, "-q" for quantity, "-l" for language, "-f" for formula, "-n" to queue another card, "-d" to capture defaults.`,
        default: "",
      },
    ]);

    let parsed;
    try {
      parsed = parseSwitchInput(switches, switchDefaults);
    } catch (err) {
      console.error(err.message);
      continue;
    }

    switchDefaults = parsed.defaults;

    console.log("Pending imports:");
    parsed.entries.forEach((entry, idx) => {
      const parts = [
        entry.condition,
        `x${entry.quantity}`,
        entry.language ? `lang:${entry.language}` : null,
        entry.formulaOverride ? `f:${entry.formulaOverride}` : null,
        entry.applyFormula === false ? "formula:off" : null,
        entry.signed ? "signed" : null,
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`  ${idx + 1}. ${parts}`);
    });

    const { confirmRun } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmRun",
        message: "Proceed with these imports?",
        default: true,
      },
    ]);

    if (!confirmRun) {
      console.log("Import cancelled.");
      continue;
    }

    try {
      for (const entry of parsed.entries) {
        await handleImportUrl(url, entry.quantity, entry.condition, config, csvPath, {
          formulaOverride: entry.formulaOverride,
          applyFormula: entry.applyFormula,
          languageOverride: entry.language,
          signed: entry.signed,
        });
      }
    } catch (err) {
      console.error("Error importing card:", err.message || err);
    }
  }
}
