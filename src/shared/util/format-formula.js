// Convert a multiplier-style formula string (e.g., "*1.2" or "1.2") into a human-friendly percentage (e.g., "120%").
// Falls back to the original string for non-multiplier markers like "manual" or "skip".
export function formatFormulaForDisplay(formulaStr) {
  if (!formulaStr) return "";
  const trimmed = String(formulaStr).trim();
  const lower = trimmed.toLowerCase();
  if (lower === "manual" || lower === "skip") return trimmed;

  const match = trimmed.match(/^\*?\s*([0-9]*\.?[0-9]+)$/);
  if (!match) return trimmed;

  const multiplier = parseFloat(match[1]);
  if (!Number.isFinite(multiplier)) return trimmed;

  const percent = multiplier * 100;
  const rounded = Number.isInteger(percent) ? percent : Number(percent.toFixed(2));
  return `${rounded}%`;
}
