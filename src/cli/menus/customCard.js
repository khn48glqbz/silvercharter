import inquirer from "inquirer";
import { ensureExpansionIconFile, findFileByFilename, searchFilesByTerm } from "../../shopify/files.js";
import createDraftAndPublishToPos from "../../shopify/draft.js";
import { appendCsvRows } from "../../utils/csv.js";
import { convertToUSD } from "../../utils/currency.js";
import { calculateFinalPrice } from "../../utils/pricing.js";
import { getLanguagesMap } from "../../utils/staticData.js";

const languages = getLanguagesMap();
const ICON_EXTENSIONS = ["png", "webp", "jpg", "jpeg"];

const CONDITION_CHOICES = [
  "Ungraded",
  "Damaged",
  "Grade 7",
  "Grade 8",
  "Grade 9",
  "Grade 9.5",
  "Grade 10",
];

const singlesConditions = new Set(["Ungraded", "Damaged"]);

function normalizeLanguage(input = "") {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  for (const [name, code] of Object.entries(languages)) {
    if (name.toLowerCase() === trimmed.toLowerCase()) return code;
  }
  throw new Error(`Unknown language "${input}".`);
}

function deriveIconFilename(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.pop() || "custom-icon.png";
    return last.split("?")[0];
  } catch {
    return "custom-icon.png";
  }
}

function slugifyExpansionName(name = "") {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function stripExtension(value = "") {
  return value.replace(/\.[^.]+$/, "");
}

function buildFilenameCandidates(term = "", fallback = "") {
  const results = [];
  const seen = new Set();
  const add = (value) => {
    if (!value) return;
    const lower = value.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    results.push(value);
  };
  const addWithExtensions = (base) => {
    if (!base) return;
    ICON_EXTENSIONS.forEach((ext) => add(`${base}.${ext}`));
  };

  const trimmed = (term || "").trim();
  if (trimmed) {
    add(trimmed);
    if (!/\.[a-z0-9]+$/i.test(trimmed)) addWithExtensions(slugifyExpansionName(trimmed));
  }

  const fallbackSlug = slugifyExpansionName(fallback || "");
  if (fallbackSlug) addWithExtensions(fallbackSlug);

  return results;
}

export default async function handleCustomCard(config, csvPath) {
  console.log("Custom card entry selected.");
  const { title } = await inquirer.prompt([
    {
      name: "title",
      message: "Name:",
      validate: (input) => !!input.trim() || "Name cannot be blank.",
    },
  ]);

  const basic = await inquirer.prompt([
    {
      name: "game",
      message: "Game:",
      validate: (input) => !!input.trim() || "Game cannot be blank.",
    },
    {
      name: "expansion",
      message: "Expansion:",
      validate: (input) => !!input.trim() || "Expansion cannot be blank.",
    },
  ]);

  const expansionSlug = slugifyExpansionName(basic.expansion);
  let expansionIconId = null;
  let iconDecisionMade = false;
  while (!iconDecisionMade) {
    const { iconMode } = await inquirer.prompt([
      {
        type: "list",
        name: "iconMode",
        message: "Expansion icon",
        choices: [
          { name: "Search Shopify files for an icon", value: "search" },
          { name: "Enter icon URL / Shopify filename / gid", value: "custom" },
          { name: "No expansion icon", value: "none" },
        ],
        default: "search",
      },
    ]);

    if (iconMode === "search") {
      const { searchTerm } = await inquirer.prompt([
        {
          name: "searchTerm",
          message: "Enter filename or slug to search:",
          default: expansionSlug || "",
        },
      ]);
      const trimmed = (searchTerm || "").trim();
      if (!trimmed) {
        console.warn("Search term cannot be blank.");
        continue;
      }
      const candidateNames = buildFilenameCandidates(trimmed, basic.expansion);
      const foundEntries = [];
      for (const candidate of candidateNames) {
        try {
          const info = await findFileByFilename(candidate);
          if (info?.id && !foundEntries.find((entry) => entry.id === info.id)) {
            foundEntries.push(info);
          }
        } catch (err) {
          // continue trying other candidates
        }
      }

      let matches = foundEntries;
      if (!matches.length) {
        try {
          matches = await searchFilesByTerm(trimmed);
        } catch (err) {
          console.warn("Failed to search files:", err.message || err);
        }
      }

      if (!matches.length) {
        console.warn(`No Shopify file found for "${trimmed}".`);
        continue;
      }

      const choices = matches.slice(0, 10).map((file) => ({
        name: file.filename,
        value: file.id,
      }));
      choices.push({ name: "Search again", value: "__retry" });

      const { selectedIcon } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedIcon",
          message: "Select an icon",
          choices,
        },
      ]);
      if (selectedIcon === "__retry") continue;
      expansionIconId = selectedIcon;
      iconDecisionMade = true;
    } else if (iconMode === "custom") {
      const { iconValue } = await inquirer.prompt([
        {
          name: "iconValue",
          message: "Enter icon URL (uploads), filename, or gid:",
          default: "",
        },
      ]);
      const input = (iconValue || "").trim();
      if (!input) {
        console.warn("Icon value cannot be blank.");
        continue;
      }
      if (/^gid:/.test(input) || input.startsWith("gid://")) {
        expansionIconId = input;
        iconDecisionMade = true;
      } else if (/^https?:/i.test(input)) {
        try {
          const suggestedName = deriveIconFilename(input) || `${expansionSlug || "custom-icon"}.png`;
          const info = await ensureExpansionIconFile({ filename: suggestedName, url: input });
          if (info?.id) {
            expansionIconId = info.id;
            iconDecisionMade = true;
            if (info?.filename) console.log(`Icon saved as: ${info.filename}`);
          } else {
            console.warn("Upload succeeded but no file ID was returned.");
          }
        } catch (err) {
          console.warn("Failed to upload icon:", err.message || err);
        }
      } else {
        try {
          const found = await findFileByFilename(input);
          if (found?.id) {
            console.log(`Found icon: ${found.filename}`);
            expansionIconId = found.id;
            iconDecisionMade = true;
          } else {
            console.warn(`Icon "${input}" not found.`);
          }
        } catch (err) {
          console.warn("Failed to apply icon:", err.message || err);
        }
      }
    } else if (iconMode === "none") {
      iconDecisionMade = true;
    }
  }

  const responses = await inquirer.prompt([
    {
      name: "language",
      message: "Language (alpha-2 code or full name):",
      validate: (input) => {
        try {
          normalizeLanguage(input || "");
          return true;
        } catch (err) {
          return err.message;
        }
      },
    },
    {
      type: "list",
      name: "condition",
      message: "Condition:",
      choices: CONDITION_CHOICES,
      default: "Ungraded",
    },
    {
      name: "quantity",
      message: "Quantity:",
      default: "1",
      validate: (input) => {
        const num = parseInt(input, 10);
        return (Number.isFinite(num) && num > 0) || "Enter a positive integer.";
      },
    },
    {
      name: "price",
      message: `Price (${config?.currency || "USD"}):`,
      validate: (input) => {
        const num = parseFloat(input);
        return (!Number.isNaN(num) && num >= 0) || "Enter a valid non-negative number.";
      },
    },
    {
      type: "list",
      name: "formulaMode",
      message: "Apply pricing formula?",
      choices: [
        { name: "Use default formula", value: "default" },
        { name: "Skip formula", value: "skip" },
        { name: "Use custom multiplier", value: "custom" },
      ],
      default: "default",
    },
  ]);

  let customFormula = null;
  if (responses.formulaMode === "custom") {
    const { formula } = await inquirer.prompt([
      {
        name: "formula",
        message: 'Enter custom formula (e.g. "*1.2" or "1.2"):',
        validate: (input) => !!input.trim() || "Formula cannot be blank.",
      },
    ]);
    customFormula = formula.trim();
  }

  const languageCode = normalizeLanguage(responses.language);
  const quantity = parseInt(responses.quantity, 10);
  const priceLocal = parseFloat(responses.price);
  const currency = (config?.currency || "USD").toUpperCase();
  const condition = responses.condition;
  const collection = singlesConditions.has(condition) ? "Singles" : "Slabs";

  let finalPrice = Number(priceLocal);
  let originalValue = "null";

  if (responses.formulaMode === "skip") {
    finalPrice = Number(Number(priceLocal).toFixed(2));
    originalValue = finalPrice.toFixed(2);
  } else {
    const baseUSD = await convertToUSD(priceLocal, currency);
    const pricing = await calculateFinalPrice(
      baseUSD,
      config,
      condition,
      customFormula,
      true
    );
    finalPrice = pricing.final;
    originalValue = Number(Number(pricing.converted).toFixed(2)).toFixed(2);
  }

  const vendor = config?.shopify?.vendor || basic.game || "Custom Vendor";
  const sourceUrl = `custom:${Date.now()}:${encodeURIComponent(title)}`;

  const result = await createDraftAndPublishToPos(
    {
      title,
      price: finalPrice,
      quantity,
      sourceUrl,
      condition,
      barcode: "",
      vendor,
      game: basic.game,
      expansion: basic.expansion,
      language: languageCode,
      collection,
      value: originalValue,
      expansionIconId,
    },
    config
  );

  appendCsvRows(
    csvPath,
    result?.variants?.[0]?.barcode ?? "",
    title,
    basic.game,
    basic.expansion,
    languageCode,
    collection,
    condition,
    finalPrice.toFixed(2),
    quantity
  );

  console.log(`Created custom product: ${title} (${condition})`);
}
