import inquirer from "inquirer";
import { ensureExpansionIconFile, findFileByFilename, searchFilesByTerm } from "../../shopify/files.js";
import createDraftAndPublishToPos from "../../shopify/draft.js";
import { appendCsvRows } from "../../utils/csv.js";
import { convertToUSD } from "../../utils/currency.js";
import { calculateFinalPrice } from "../../utils/pricing.js";
import { getLanguagesMap, getVendorsMap } from "../../utils/staticData.js";
import { getCustomExpansions } from "../../utils/customExpansions.js";

/**
 * Custom card workflow
 * --------------------
 * This module lets operators enter entirely manual cards (non-scraped).  The flow is:
 *  1. Gather title/game/expansion info (with vendor lookup + custom expansion cache).
 *  2. Prompt for icon handling (auto suggestions, Shopify search, uploads, signed flag).
 *  3. Gather pricing inputs (currency, formula overrides, signed manual pricing).
 *  4. Persist to Shopify via `createDraftAndPublishToPos` and append the CSV entry.
 *
 * Helpers at the top of the file intentionally stay pure so the bottom `handleCustomCard`
 * reads like the high-level workflow we explain in docs/workflow-notes.md.
 */

// ---- Global data lookups / config ----
const languages = getLanguagesMap();
const vendors = getVendorsMap();
const KNOWN_GAMES = Object.keys(vendors || {}).sort((a, b) => a.localeCompare(b));
const FALLBACK_GAMES = ["Pokemon", "Yu-Gi-Oh", "Magic: The Gathering", "One Piece", "Dragon Ball Super"];
if (!KNOWN_GAMES.length) {
  console.warn("Warning: vendors.json could not be loaded. Using fallback game list.");
}
const ICON_EXTENSIONS = ["png", "webp", "jpg", "jpeg"];
const LANGUAGE_OVERRIDES = {
  EN: "",
  JP: "japanese",
  JA: "japanese",
};

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

function applySignatureSuffix(title, signed) {
  if (!signed) return title;
  return title.includes("(Signature)") ? title : `${title} (Signature)`;
}

function slugifyValue(value = "") {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function formatIconLabel(file) {
  if (!file) return "Unnamed file";
  const name = file.filename || "Unnamed file";
  if (file.width && file.height) return `${name} (${file.width}x${file.height})`;
  return name;
}

function normalizeLanguage(input = "") {
  const trimmed = input.trim() || "EN";
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  for (const [name, code] of Object.entries(languages)) {
    if (name.toLowerCase() === trimmed.toLowerCase()) return code;
  }
  throw new Error(`Unknown language "${input}".`);
}

function getLanguageSlug(code = "") {
  const upper = (code || "").toUpperCase();
  if (!upper || upper === "EN") return "";
  if (LANGUAGE_OVERRIDES[upper] !== undefined) {
    return slugifyValue(LANGUAGE_OVERRIDES[upper]);
  }
  const match = Object.entries(languages).find(([, value]) => (value || "").toUpperCase() === upper);
  if (match) return slugifyValue(match[0]);
  return slugifyValue(upper);
}

function createIconBasename(game = "", expansion = "", languageCode = "") {
  const parts = [];
  const gameSlug = slugifyValue(game);
  if (gameSlug) parts.push(gameSlug);
  const languageSlug = getLanguageSlug(languageCode);
  if (languageSlug) parts.push(languageSlug);
  const expansionSlug = slugifyValue(expansion);
  if (expansionSlug) parts.push(expansionSlug);
  return parts.join("-");
}

function guessExtensionFromUrl(url = "") {
  const match = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
  if (match) return match[1].toLowerCase();
  return "png";
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
    if (!/\.[a-z0-9]+$/i.test(trimmed)) addWithExtensions(trimmed);
  }

  const fallbackSlug = slugifyValue(fallback || "");
  if (fallbackSlug) addWithExtensions(fallbackSlug);

  return results;
}

async function getIconSuggestions(iconSlug = "", fallback = "") {
  const suggestions = [];
  const seen = new Set();
  const candidateNames = buildFilenameCandidates(iconSlug, fallback);
  for (const candidate of candidateNames) {
    try {
      const info = await findFileByFilename(candidate);
      if (info?.id && !seen.has(info.id)) {
        seen.add(info.id);
        suggestions.push(info);
      }
    } catch {
      /* ignore */
    }
  }

  const secondarySlug = slugifyValue(iconSlug || fallback);
  if (secondarySlug && suggestions.length < 5) {
    try {
      const matches = await searchFilesByTerm(secondarySlug);
      for (const file of matches) {
        if (!file?.id || seen.has(file.id)) continue;
        const name = (file.filename || "").toLowerCase();
        if (!name.includes(secondarySlug)) continue;
        seen.add(file.id);
        suggestions.push(file);
        if (suggestions.length >= 5) break;
      }
    } catch {
      /* ignore */
    }
  }

  return suggestions;
}

async function promptGameSelection(defaultGame = "", defaultVendor = "") {
  const availableGames = KNOWN_GAMES.length ? KNOWN_GAMES : FALLBACK_GAMES;
  const choices = availableGames.map((game) => ({
    name: game,
    value: game,
  }));
  choices.push(new inquirer.Separator(), { name: "Custom / other game", value: "__custom" });

  let defaultValue = defaultGame && availableGames.includes(defaultGame) ? defaultGame : choices[0].value;

  const { selectedGame } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedGame",
      message: "Select game:",
      choices,
      default: defaultValue,
    },
  ]);

  if (selectedGame === "__custom") {
    const answers = await inquirer.prompt([
      {
        name: "customGame",
        message: "Enter game name:",
        default: defaultGame || "",
        validate: (input) => !!input.trim() || "Game cannot be blank.",
      },
      {
        name: "customVendor",
        message: "Enter vendor/publisher name:",
        default: defaultVendor || "",
        validate: (input) => !!input.trim() || "Vendor cannot be blank.",
      },
    ]);
    return {
      game: answers.customGame.trim(),
      vendor: answers.customVendor.trim(),
    };
  }

  let resolvedVendor = vendors[selectedGame];
  if (!resolvedVendor) {
    const { fallbackVendor } = await inquirer.prompt([
      {
        name: "fallbackVendor",
        message: `Enter vendor/publisher for ${selectedGame}:`,
        default: defaultVendor || "",
        validate: (input) => !!input.trim() || "Vendor cannot be blank.",
      },
    ]);
    resolvedVendor = fallbackVendor.trim();
  }

  return {
    game: selectedGame,
    vendor: resolvedVendor,
  };
}

export default async function handleCustomCard(config, csvPath) {
  console.log("Custom card entry selected.");
  let customExpansionMap = {};
  try {
    const cache = await getCustomExpansions();
    customExpansionMap = cache?.expansions || {};
  } catch (err) {
    console.warn("Unable to load custom expansions cache:", err.message || err);
    customExpansionMap = {};
  }

  let continueAdding = true;
  let carryover = {
    language: "EN",
    condition: "Ungraded",
    formulaMode: "default",
    customFormula: null,
    game: "",
    vendor: "",
    expansion: "",
    signed: false,
  };

  while (continueAdding) {
    const { title } = await inquirer.prompt([
      {
        name: "title",
        message: "Name:",
        validate: (input) => !!input.trim() || "Name cannot be blank.",
      },
    ]);

    const { game, vendor } = await promptGameSelection(carryover.game, carryover.vendor);

    const customGameExpansions = Array.isArray(customExpansionMap[game])
      ? customExpansionMap[game]
      : [];

    let expansion = carryover.expansion || "";
    if (customGameExpansions.length) {
      const sorted = customGameExpansions.slice().sort((a, b) => a.localeCompare(b));
      const expChoices = sorted.map((name) => ({ name, value: name }));
      expChoices.push(new inquirer.Separator(), { name: "Enter expansion manually", value: "__manual" });
      const defaultChoice = sorted.includes(carryover.expansion) ? carryover.expansion : expChoices[0].value;
      const { expansionChoice } = await inquirer.prompt([
        {
          type: "list",
          name: "expansionChoice",
          message: `Select expansion for ${game}:`,
          choices: expChoices,
          default: defaultChoice,
        },
      ]);
      if (expansionChoice === "__manual") {
        const { manualExpansion } = await inquirer.prompt([
          {
            name: "manualExpansion",
            message: "Expansion:",
            default: carryover.expansion || "",
            validate: (input) => !!input.trim() || "Expansion cannot be blank.",
          },
        ]);
        expansion = manualExpansion.trim();
      } else {
        expansion = expansionChoice;
      }
    } else {
      const { manualExpansion } = await inquirer.prompt([
        {
          name: "manualExpansion",
          message: "Expansion:",
          default: carryover.expansion || "",
          validate: (input) => !!input.trim() || "Expansion cannot be blank.",
        },
      ]);
      expansion = manualExpansion.trim();
    }

    const { languageInput } = await inquirer.prompt([
      {
        name: "languageInput",
        message: "Language (alpha-2 code or full name):",
        default: carryover.language || "EN",
        validate: (input) => {
          try {
            normalizeLanguage(input || carryover.language || "EN");
            return true;
          } catch (err) {
            return err.message;
          }
        },
      },
    ]);
    const languageCode = normalizeLanguage(languageInput || carryover.language || "EN");

    const { isSigned } = await inquirer.prompt([
      {
        type: "confirm",
        name: "isSigned",
        message: "Is this card signed?",
        default: carryover.signed || false,
      },
    ]);
    const signed = !!isSigned;

    const iconSlug = createIconBasename(game, expansion, languageCode);

    let expansionIconId = null;
    let iconDecisionMade = false;
    let cachedSuggestions = [];
    try {
      cachedSuggestions = await getIconSuggestions(iconSlug, expansion);
      if (cachedSuggestions?.length) {
        console.log(`Suggested icons found for "${iconSlug}".`);
      }
    } catch (err) {
      console.warn("Failed to load icon suggestions:", err.message || err);
    }

    while (!iconDecisionMade) {
      const choices = [];
      cachedSuggestions.forEach((file) => {
        choices.push({
          name: `Use ${formatIconLabel(file)}`,
          value: `suggestion:${file.id}`,
        });
      });
      choices.push(
        { name: "Search Shopify files for an icon", value: "search" },
        { name: "Enter icon URL / Shopify filename / gid", value: "custom" },
        { name: "No expansion icon", value: "none" }
      );
      const defaultValue = cachedSuggestions.length ? choices[0].value : "search";

      const { iconSelection } = await inquirer.prompt([
        {
          type: "list",
          name: "iconSelection",
          message: "Expansion icon",
          choices,
          default: defaultValue,
        },
      ]);

      if (iconSelection.startsWith("suggestion:")) {
        expansionIconId = iconSelection.slice("suggestion:".length);
        iconDecisionMade = true;
        continue;
      }

      if (iconSelection === "search") {
        const { searchTerm } = await inquirer.prompt([
          {
            name: "searchTerm",
            message: "Enter filename or slug to search:",
            default: iconSlug || slugifyValue(expansion) || "",
          },
        ]);
        const trimmed = (searchTerm || "").trim();
        if (!trimmed) {
          console.warn("Search term cannot be blank.");
          continue;
        }
        const candidateNames = buildFilenameCandidates(trimmed, expansion);
        const foundEntries = [];
        for (const candidate of candidateNames) {
          try {
            const info = await findFileByFilename(candidate);
            if (info?.id && !foundEntries.find((entry) => entry.id === info.id)) {
              foundEntries.push(info);
            }
          } catch {
            // ignore
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

        const selectChoices = matches.slice(0, 10).map((file) => ({
          name: formatIconLabel(file),
          value: file.id,
        }));
        selectChoices.push({ name: "Search again", value: "__retry" });

        const { selectedIcon } = await inquirer.prompt([
          {
            type: "list",
            name: "selectedIcon",
            message: "Select an icon",
            choices: selectChoices,
          },
        ]);
        if (selectedIcon === "__retry") continue;
        expansionIconId = selectedIcon;
        iconDecisionMade = true;
      } else if (iconSelection === "custom") {
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
            const extension = guessExtensionFromUrl(input);
            const baseName = createIconBasename(game, expansion, languageCode) || slugifyValue(expansion) || "custom-icon";
            const suggestedName = `${baseName}.${extension}`;
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
      } else if (iconSelection === "none") {
        iconDecisionMade = true;
      }
    }

    const responses = await inquirer.prompt([
      {
        type: "list",
        name: "condition",
        message: "Condition:",
        choices: CONDITION_CHOICES,
        default: carryover.condition || "Ungraded",
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
        default: carryover.formulaMode || "default",
      },
    ]);

    let customFormula = null;
    if (responses.formulaMode === "custom") {
      const { formula } = await inquirer.prompt([
        {
          name: "formula",
          message: 'Enter custom formula (e.g. "*1.2" or "1.2"):',
          validate: (input) => !!input.trim() || "Formula cannot be blank.",
          default: carryover.customFormula || "",
        },
      ]);
      customFormula = formula.trim();
    }

    const quantity = parseInt(responses.quantity, 10);
    const priceLocal = parseFloat(responses.price);
    const currency = (config?.currency || "USD").toUpperCase();
    const condition = responses.condition;
    const collection = signed || singlesConditions.has(condition) ? "Singles" : "Slabs";

    let finalPrice = Number(priceLocal);
    let originalValue = "null";

    if (signed) {
      finalPrice = Number(Number(priceLocal).toFixed(2));
      originalValue = "null";
    } else if (responses.formulaMode === "skip") {
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

    const resolvedVendor = vendor || config?.shopify?.vendor || game || "Custom Vendor";
    const sourceUrl = "null";

    const displayTitle = applySignatureSuffix(title, signed);

    const result = await createDraftAndPublishToPos(
      {
        title: displayTitle,
        price: finalPrice,
        quantity,
        sourceUrl,
        condition,
        barcode: "",
        vendor: resolvedVendor,
        game,
        expansion,
        language: languageCode,
        collection,
        value: originalValue,
        expansionIconId,
        signed,
      },
      config
    );

    appendCsvRows(
      csvPath,
      result?.variants?.[0]?.barcode ?? "",
      displayTitle,
      game,
      expansion,
      languageCode,
      collection,
      condition,
      finalPrice.toFixed(2),
      quantity
    );

    console.log(`Created custom product: ${displayTitle} (${condition})`);

    carryover = {
      language: languageCode,
      condition,
      formulaMode: responses.formulaMode,
      customFormula: responses.formulaMode === "custom" ? customFormula : null,
      game,
      vendor,
      expansion,
      signed,
    };

    const { addAnother } = await inquirer.prompt([
      {
        type: "confirm",
        name: "addAnother",
        message: "Add another custom card with these defaults?",
        default: false,
      },
    ]);
    continueAdding = addAnother;
  }
}
