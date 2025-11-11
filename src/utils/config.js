import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_PATH = path.join(DATA_DIR, "defaults.json");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

const DEFAULT_CONFIG = {
  currency: "GBP",
  formula: {
    Damaged: "*0.9",
    Ungraded: "*1.2",
    "Grade 7": "*1.4",
    "Grade 8": "*1.5",
    "Grade 9": "*1.8",
    "Grade 9.5": "*2",
    "Grade 10": "*2.5",
    roundTo99: true,
  },
  sessionID: 0,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeConfig(rawConfig = {}) {
  const normalized = { ...rawConfig };

  if (!normalized.currency) normalized.currency = DEFAULT_CONFIG.currency;
  if (typeof normalized.sessionID !== "number") normalized.sessionID = 0;
  // Handle legacy "pricing" shape by upgrading to formula table
  if (!normalized.formula || typeof normalized.formula !== "object") {
    normalized.formula = {};
  }

  if (normalized.pricing && typeof normalized.pricing === "object") {
    if (!Object.keys(normalized.formula).length && typeof normalized.pricing.formula === "string") {
      normalized.formula.Ungraded = normalized.pricing.formula;
    }
    if (typeof normalized.pricing.roundTo99 === "boolean") {
      normalized.formula.roundTo99 = normalized.pricing.roundTo99;
    }
    delete normalized.pricing;
  }

  if (!Object.keys(normalized.formula).length) {
    normalized.formula = { ...DEFAULT_CONFIG.formula };
  } else {
    if (!normalized.formula.Ungraded) normalized.formula.Ungraded = "*1";
    if (typeof normalized.formula.roundTo99 !== "boolean") {
      normalized.formula.roundTo99 = DEFAULT_CONFIG.formula.roundTo99;
    }
  }

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
