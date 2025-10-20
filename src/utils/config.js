import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "data", "config.json");

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      currency: "GBP",
      pricing: { formula: "*1.0", roundTo99: false },
      shopify: { vendor: "The Pokemon Company", collection: "Singles" },
      nextSessionId: 1
    };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), "utf8");
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

export function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function getAndIncrementSessionId() {
  const config = loadConfig();
  if (typeof config.nextSessionId !== "number" || isNaN(config.nextSessionId)) {
    config.nextSessionId = 1;
  }
  const id = config.nextSessionId;
  config.nextSessionId = id + 1;
  saveConfig(config);
  return id;
}
