import fs from "fs";
import path from "path";

const LABELS_DIR = path.join(process.cwd(), "labels");

function ensureLabelsDir() {
  if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR, { recursive: true });
}

export function createSessionCSVWithId(sessionId) {
  ensureLabelsDir();
  const filePath = path.join(LABELS_DIR, `session_${sessionId}.csv`);
  // New CSV header
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "Variant Barcode,Title,Variant Price,Grade,Type,Game\n", "utf8");
  }
  return filePath;
}

/**
 * Append rows in the new CSV format
 * @param {*} filePath 
 * @param {*} barcode
 * @param {*} title 
 * @param {*} priceStr 
 * @param {*} grade 
 * @param {*} type 
 * @param {*} game 
 * @param {*} quantity 
 */
export function appendCsvRows(filePath, barcode, title, priceStr, grade = "-", type = "Singles", game = "Pokémon", quantity = 1) {
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  let out = "";
  for (let i = 0; i < quantity; i++) {
    out += [esc(barcode), esc(title), esc(priceStr), esc(grade), esc(type), esc(game)].join(",") + "\n";
  }
  fs.appendFileSync(filePath, out, "utf8");
}
