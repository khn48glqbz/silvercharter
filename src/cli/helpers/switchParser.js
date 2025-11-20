import { getLanguagesMap } from "../../utils/staticData.js";

const languages = getLanguagesMap();

function tokenize(input = "") {
  const matches = input.match(/"[^"]*"|\S+/g);
  if (!matches) return [];
  return matches.map((tok) => tok.replace(/^"|"$/g, ""));
}

function ensurePositiveInteger(value, label) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) throw new Error(`${label} must be a positive integer.`);
  return num;
}

function normalizeCondition(value = "") {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Condition flag requires a value.");
  if (/^u(ngraded)?$/i.test(trimmed)) return "Ungraded";
  if (/^d(amaged)?$/i.test(trimmed)) return "Damaged";
  let grade = trimmed.toUpperCase();
  if (grade.startsWith("G")) grade = grade.slice(1);
  grade = grade.replace(/[^0-9.]/g, "");
  if (!grade) throw new Error(`Invalid grade "${value}".`);
  if (grade === "9.5") return "Grade 9.5";
  return `Grade ${grade.replace(/\.0$/, "")}`;
}

function normalizeLanguage(value = "") {
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  for (const [name, code] of Object.entries(languages)) {
    if (name.toLowerCase() === trimmed.toLowerCase()) return code;
  }
  throw new Error(`Unknown language "${value}".`);
}

function normalizeFormula(value = "") {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Formula flag requires a value.");
  if (/^(no|off|false)$/i.test(trimmed)) return { apply: false, override: null };
  if (/^(yes|on|true|default)$/i.test(trimmed)) return { apply: true, override: null };
  let formatted = trimmed;
  if (/^[0-9.]+$/.test(formatted)) formatted = `*${formatted}`;
  return { apply: true, override: formatted };
}

function parseBoolean(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  const trimmed = String(value).trim();
  if (/^false$/i.test(trimmed)) return false;
  if (/^true$/i.test(trimmed)) return true;
  return defaultValue;
}

export function parseSwitchInput(rawInput, defaults) {
  const tokens = tokenize(rawInput.trim());
  const entries = [];
  let newDefaults = { ...defaults };
  let pendingDefault = false;

  const initCurrent = () => ({
    condition: newDefaults.condition,
    quantity: newDefaults.quantity,
    language: newDefaults.language ?? null,
    applyFormula: typeof newDefaults.applyFormula === "boolean" ? newDefaults.applyFormula : true,
    formulaOverride: newDefaults.formulaOverride ?? null,
    signed: !!newDefaults.signed,
  });

  let current = initCurrent();
  let conditionSet = false;

  const setCondition = (cond, persist = false) => {
    if (conditionSet) throw new Error("Only one condition flag allowed per card. Use -n to start a new entry.");
    current.condition = cond;
    conditionSet = true;
    if (persist) newDefaults.condition = cond;
  };

  const commitEntry = () => {
    entries.push({ ...current });
    if (pendingDefault) {
      newDefaults = { ...current };
      pendingDefault = false;
    }
    current = initCurrent();
    conditionSet = false;
  };

  if (!tokens.length) {
    commitEntry();
    return { entries, defaults: newDefaults };
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("-")) throw new Error(`Unexpected token "${token}". Flags must start with "-".`);

    if (token === "-default") {
      pendingDefault = true;
      continue;
    }

    const [, keyRaw = "", inlineValue = ""] = token.match(/^-([A-Za-z]+)(.*)$/) || [];
    if (!keyRaw) throw new Error("Invalid flag syntax.");
    const isUpper = keyRaw === keyRaw.toUpperCase();
    const key = keyRaw.toLowerCase();
    let value = inlineValue;
    if (!value && i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
      value = tokens[++i];
    }

    if (key === "n") {
      commitEntry();
      continue;
    }

    if (key === "u") {
      setCondition("Ungraded", isUpper);
      continue;
    }

    if (key === "d") {
      setCondition("Damaged", isUpper);
      continue;
    }

    if (key === "s") {
      const boolValue = parseBoolean(value, true);
      current.signed = boolValue;
      if (isUpper) newDefaults.signed = boolValue;
      continue;
    }

    if (key === "g") {
      const cond = normalizeCondition(`g${value || ""}`);
      setCondition(cond, isUpper);
      continue;
    }

    if (key === "q") {
      current.quantity = ensurePositiveInteger(value, "Quantity");
      if (isUpper) newDefaults.quantity = current.quantity;
      continue;
    }

    if (key === "l" || key === "lang") {
      current.language = normalizeLanguage(value || "");
      if (isUpper) newDefaults.language = current.language;
      continue;
    }

    if (key === "f") {
      const { apply, override } = normalizeFormula(value || "");
      current.applyFormula = apply;
      current.formulaOverride = override;
      if (isUpper) {
        newDefaults.applyFormula = apply;
        newDefaults.formulaOverride = override;
      }
      continue;
    }

    throw new Error(`Unknown flag "-${keyRaw}". Supported flags: -u, -d, -g, -q, -l/-lang, -f, -n, -default.`);
  }

  commitEntry();
  return { entries, defaults: newDefaults };
}
