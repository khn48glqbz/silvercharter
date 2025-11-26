// src/utils/csv.js
import fs from "fs";
import path from "path";

const LABELS_DIR = path.join(process.cwd(), "data", "labels");

function ensureLabelsDir() {
  if (fs.existsSync(LABELS_DIR)) return;
  try {
    fs.mkdirSync(LABELS_DIR, { recursive: true });
  } catch (err) {
    console.warn(`Could not create labels directory at ${LABELS_DIR}:`, err.message || err);
    console.warn("Ensure you have write permissions to the repo directory.");
    throw err;
  }
}

const SESSION_HEADERS = {
  import: "Variant Barcode,Title,Game,Expansion,Language,Type,Condition,Variant Price\n",
  repricing: "Variant Barcode,Title,Game,Expansion,Language,Type,Condition,Variant Price\n",
  default: "Variant Barcode,Title,Game,Expansion,Language,Type,Condition,Variant Price\n",
};

export function createSessionCSVWithId(sessionId, type = "import") {
  ensureLabelsDir();
  const prefix = type ? `${type}_session` : "session";
  const filePath = path.join(LABELS_DIR, `${prefix}_${sessionId}.csv`);
  if (!fs.existsSync(filePath)) {
    const header = SESSION_HEADERS[type] || SESSION_HEADERS.default;
    fs.writeFileSync(filePath, header, "utf8");
  }
  return filePath;
}

export function listSessionFiles(type = "import") {
  ensureLabelsDir();
  const prefixes = type === "import" ? [`${type}_session_`, "session_"] : [`${type}_session_`];
  return fs
    .readdirSync(LABELS_DIR)
    .filter((file) => file.endsWith(".csv") && prefixes.some((prefix) => file.startsWith(prefix)))
    .map((file) => ({ name: file, path: path.join(LABELS_DIR, file) }));
}

/**
 * Append rows in the CSV format
 * @param {*} filePath
 * @param {*} barcode
 * @param {*} title
 * @param {*} game
 * @param {*} expansion
 * @param {*} language
 * @param {*} type
 * @param {*} condition
 * @param {*} priceStr
 * @param {*} quantity
 */
export function appendCsvRows(
  filePath,
  barcode,
  title,
  game = "Unknown Game",
  expansion = "Unknown Expansion",
  language = "EN",
  type = "Singles",
  condition = "-",
  priceStr = "0.00",
  quantity = 1
) {
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  let out = "";
  for (let i = 0; i < quantity; i++) {
    out +=
      [esc(barcode), esc(title), esc(game), esc(expansion), esc(language), esc(type), esc(condition), esc(priceStr)].join(",") +
      "\n";
  }
  fs.appendFileSync(filePath, out, "utf8");
}
