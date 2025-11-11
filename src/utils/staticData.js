import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const VENDORS_PATH = path.join(DATA_DIR, "vendors.json");
const LANGUAGES_PATH = path.join(DATA_DIR, "languages.json");

let vendorsCache = null;
let languagesCache = null;

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Failed to read ${path.basename(filePath)}: ${err.message}`);
    return {};
  }
}

export function getVendorsMap() {
  if (!vendorsCache) {
    vendorsCache = readJsonSafe(VENDORS_PATH);
  }
  return vendorsCache;
}

export function getLanguagesMap() {
  if (!languagesCache) {
    languagesCache = readJsonSafe(LANGUAGES_PATH);
  }
  return languagesCache;
}
