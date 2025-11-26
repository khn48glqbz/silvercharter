import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_DIR = path.join(DATA_DIR, "config");
const DEFAULT_PATH = path.join(CONFIG_DIR, "defaults.json");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");

const DEFAULT_CONFIG = {
  currency: "GBP",
  formula: {
    Damaged: { multiplier: "*0.8", rounding: { mode: "down", targets: [0.99] } },
    Ungraded: { multiplier: "*1", rounding: { mode: "up", targets: [0.99] } },
    "Grade 7": { multiplier: "*1", rounding: { mode: "nearest", targets: [0.99] } },
    "Grade 8": { multiplier: "*1", rounding: { mode: "nearest", targets: [0.99] } },
    "Grade 9": { multiplier: "*1", rounding: { mode: "nearest", targets: [0.99] } },
    "Grade 9.5": { multiplier: "*1", rounding: { mode: "nearest", targets: [0.99] } },
    "Grade 10": { multiplier: "*1", rounding: { mode: "nearest", targets: [0.99] } },
  },
  sessionID: 0,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function normalizeConfig(rawConfig = {}) {
  const normalized = { ...rawConfig };

  if (!normalized.currency) normalized.currency = DEFAULT_CONFIG.currency;
  if (typeof normalized.sessionID !== "number") normalized.sessionID = 0;
  if (normalized.shopify) delete normalized.shopify;
  const normalizeEntry = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entry = { ...value };
      if (!entry.multiplier) entry.multiplier = "*1";
      return entry;
    }
    if (typeof value === "string") return { multiplier: value };
    return { multiplier: "*1" };
  };

  // Start fresh formula object
  let formula = {};
  if (normalized.formula && typeof normalized.formula === "object") {
    formula = { ...normalized.formula };
  }

  // Handle legacy "pricing" shape by upgrading to formula table
  if (normalized.pricing && typeof normalized.pricing === "object") {
    if (!Object.keys(formula).length && typeof normalized.pricing.formula === "string") {
      formula.Ungraded = normalized.pricing.formula;
    }
    // roundTo99 will be handled below as legacy -> per-condition/roundingDefault
    delete normalized.pricing;
  }

  if (!Object.keys(formula).length) {
    formula = { ...DEFAULT_CONFIG.formula };
  }

  let legacyRoundFlag = false;

  // Normalize each condition entry
  const normalizedFormula = {};
  for (const [key, value] of Object.entries(formula)) {
    if (key === "roundTo99") {
      // legacy global flag -> apply to all conditions that lack rounding
      if (typeof value === "boolean" && value === true) {
        legacyRoundFlag = true;
      }
      continue;
    }

    normalizedFormula[key] = normalizeEntry(value);
  }

  // Apply legacy roundTo99 to any condition lacking rounding
  if (legacyRoundFlag) {
    for (const [k, v] of Object.entries(normalizedFormula)) {
      if (!v.rounding) normalizedFormula[k] = { ...v, rounding: { mode: "up", targets: ["99"] } };
    }
  }

  if (!normalizedFormula.Ungraded) normalizedFormula.Ungraded = normalizeEntry("*1");

  normalized.formula = normalizedFormula;

  return normalized;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Load default config
export function loadDefaultConfig() {
  ensureDataDir();
  if (!fs.existsSync(DEFAULT_PATH)) {
    writeJson(DEFAULT_PATH, DEFAULT_CONFIG);
  }
  const defaults = normalizeConfig(readJson(DEFAULT_PATH));
  writeJson(DEFAULT_PATH, defaults); // keep defaults.json in the latest schema
  return defaults;
}

// Load user settings, fallback to default
export function loadConfig() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_PATH)) {
    writeJson(SETTINGS_PATH, loadDefaultConfig());
  }
  const config = normalizeConfig(readJson(SETTINGS_PATH));
  writeJson(SETTINGS_PATH, config); // persist any schema upgrades
  return config;
}

// Save user settings
export function saveConfig(config) {
  ensureDataDir();
  writeJson(SETTINGS_PATH, normalizeConfig(config));
}

// Increment sessionID **before** starting session
export function getAndIncrementSessionId() {
  const config = loadConfig();
  config.sessionID = (config.sessionID || 0) + 1; // increment first
  saveConfig(config);
  return config.sessionID;
}

// Restore settings from default
export function restoreDefaults() {
  const defaults = loadDefaultConfig();
  saveConfig(defaults);
  return defaults;
}
