// Parses CLI switches like "-g9 -q2" (per entry) and "-G9 -Q2" (update defaults).
const CONDITION_MAP = {
  U: "Ungraded",
  D: "Damaged",
  G7: "Grade 7",
  G8: "Grade 8",
  G9: "Grade 9",
  G95: "Grade 9.5",
  G10: "Grade 10",
};

function normalizeCondition(raw = "") {
  let key = raw.trim().toUpperCase();
  if (!key) return null;
  if (/^\d/.test(key)) {
    key = `G${key}`;
  }
  if (key.startsWith("G") && key.includes(".")) {
    key = key.replace(".", "");
  }
  return CONDITION_MAP[key] || null;
}

function ensurePositiveInteger(value, label) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return num;
}

export function parseSwitchInput(input, defaults) {
  const trimmed = (input || "").trim();
  const newDefaults = { ...defaults };

  if (!trimmed) {
    return { entries: [{ condition: defaults.condition, quantity: defaults.quantity }], defaults: newDefaults };
  }

  const tokens = trimmed.split(/\s+/);
  const entries = [];
  let current = { condition: defaults.condition, quantity: defaults.quantity };
  let entryDirty = false;

  const commitEntry = () => {
    entries.push({ ...current });
    current = { condition: newDefaults.condition, quantity: newDefaults.quantity };
    entryDirty = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    if (!token.startsWith("-")) {
      throw new Error(`Unexpected token "${token}". Flags must start with "-".`);
    }

    token = token.slice(1);
    if (!token) throw new Error("Flag missing identifier after '-'.");

    const flag = token[0];
    let value = token.slice(1);
    const isUpper = flag === flag.toUpperCase();
    const flagLower = flag.toLowerCase();

    if (!value && flagLower !== "n") {
      if (i + 1 >= tokens.length) {
        throw new Error(`Flag "-${flag}" requires a value.`);
      }
      value = tokens[++i];
    }

    if (flagLower === "g") {
      const condition = normalizeCondition(value);
      if (!condition) {
        const valid = Object.keys(CONDITION_MAP).join(", ");
        throw new Error(`Unknown grade "${value}". Valid options: ${valid}`);
      }
      current.condition = condition;
      entryDirty = true;
      if (isUpper) newDefaults.condition = condition;
    } else if (flagLower === "q") {
      const qty = ensurePositiveInteger(value, "Quantity");
      current.quantity = qty;
      entryDirty = true;
      if (isUpper) newDefaults.quantity = qty;
    } else if (flagLower === "n") {
      commitEntry();
    } else {
      throw new Error(`Unknown flag "-${flag}". Supported flags: -g, -q, -n (uppercase versions set defaults).`);
    }
  }

  if (entryDirty || !entries.length) {
    entries.push({ ...current });
  }

  return { entries, defaults: newDefaults };
}
