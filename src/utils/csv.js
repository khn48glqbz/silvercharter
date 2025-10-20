import fs from "fs";
import path from "path";

const LABELS_DIR = path.join(process.cwd(), "labels");

function ensureLabelsDir() {
  if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR, { recursive: true });
}

export function createSessionCSVWithId(sessionId) {
  ensureLabelsDir();
  const filePath = path.join(LABELS_DIR, `session_${sessionId}.csv`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "Date,Price,Name,Grade\n", "utf8");
  return filePath;
}

export function appendCsvRows(filePath, dateOnly, priceStr, name, grade, quantity) {
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  let out = "";
  for (let i = 0; i < quantity; i++) {
    out += [esc(dateOnly), esc(priceStr), esc(name), esc(grade || "")].join(",") + "\n";
  }
  fs.appendFileSync(filePath, out, "utf8");
}
