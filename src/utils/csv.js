// src/utils/csv.js
import fs from "fs";
import path from "path";

const LABELS_DIR = path.join(process.cwd(), "labels");

function ensureLabelsDir() {
  if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR, { recursive: true });
}

export function createSessionCSVWithId(sessionId) {
  ensureLabelsDir();
  const filePath = path.join(LABELS_DIR, `session_${sessionId}.csv`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      "Variant Barcode,Title,Game,Expansion,Language,Type,Condition,Variant Price\n",
      "utf8"
    );
  }
  return filePath;
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
