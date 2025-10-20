import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_PATH = path.join(DATA_DIR, "defaults.json");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Load default config
export function loadDefaultConfig() {
  if (!fs.existsSync(DEFAULT_PATH)) {
    fs.writeFileSync(DEFAULT_PATH, JSON.stringify({
      currency: "GBP",
      pricing: { formula: "*1", roundTo99: true },
      shopify: { vendor: "The Pokemon Company", brand: "Pokemon", collection: "Singles" },
      sessionID: 0
    }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DEFAULT_PATH, "utf8"));
}

// Load user settings, fallback to default
export function loadConfig() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    const defaults = loadDefaultConfig();
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaults, null, 2));
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
}

// Save user settings
export function saveConfig(config) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config, null, 2));
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
