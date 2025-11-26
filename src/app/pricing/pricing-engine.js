// src/utils/pricing.js
import { convertUSD } from "../../shared/util/currency.js";

function parseRoundingTarget(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    if (!Number.isFinite(num)) return null;
    // If the target looks like "99" or "50", treat as cents -> divide by 100.
    if (num > 1) return Math.max(0, Math.min(1, num / 100));
    return Math.max(0, Math.min(1, num));
  }
  return null;
}

/**
 * Apply arithmetic pricing formula.
 * Accepts formulas that start with an operator (e.g. "*1.2", "+3", "/2")
 * or bare number (e.g. "1.2" -> treated as "*1.2").
 */
export function applyPricingFormula(base, formula) {
  if (typeof formula !== "string") return base;

  let f = formula.trim();
  if (/^[0-9]/.test(f)) f = `*${f}`;

  // Only allow digits, operators, dots and parentheses
  const safe = f.replace(/[^0-9+\-*/().]/g, "");

  if (!/^[+\-*/]/.test(safe)) {
    console.warn(`Invalid formula format "${formula}", expected to start with + - * or /`);
    return base;
  }

  try {
    // eslint-disable-next-line no-eval
    const result = eval(`${base}${safe}`);
    return typeof result === "number" && !isNaN(result) ? result : base;
  } catch (err) {
    console.warn("Error applying pricing formula:", err.message);
    return base;
  }
}

/**
 * Rounding helper for arbitrary targets and modes.
 * rounding = { mode: "up" | "down" | "nearest", targets: [Number, ...] }
 */
export function applyRounding(value, rounding) {
  if (!rounding || typeof rounding !== "object") return Number(Number(value).toFixed(2));
  const mode = (rounding.mode || "nearest").toLowerCase();
  if (mode === "none") {
    return Number(Number(value).toFixed(2));
  }
  const parsedTargets = (Array.isArray(rounding.targets) ? rounding.targets : [rounding.targets]).map(parseRoundingTarget).filter((t) => t !== null);
  const targets = parsedTargets.length ? parsedTargets : [0.99];

  const candidates = [];
  const abs = Math.abs;

  for (const target of targets) {
    const frac = target;
    const baseInt = Math.floor(value);
    const lower = baseInt + frac - 1; // previous target
    const upper = baseInt + frac; // current target in this integer band

    if (mode === "up") {
      const candidate = value <= upper ? upper : upper + 1;
      candidates.push({ value: candidate, delta: candidate - value });
    } else if (mode === "down") {
      const candidate = value >= upper ? upper : upper - 1;
      candidates.push({ value: candidate, delta: value - candidate });
    } else {
      // nearest
      const below = value >= upper ? upper : upper - 1;
      const above = value <= upper ? upper : upper + 1;
      const deltaBelow = abs(value - below);
      const deltaAbove = abs(above - value);
      const pickAbove = deltaAbove <= deltaBelow;
      const candidate = pickAbove ? above : below;
      candidates.push({ value: candidate, delta: pickAbove ? deltaAbove : deltaBelow, tiePrefers: pickAbove ? "above" : "below" });
    }
  }

  if (!candidates.length) return Number(Number(value).toFixed(2));

  if (mode === "up") {
    const chosen = candidates.reduce((best, c) => {
      if (c.value < value) return best;
      if (!best || c.value < best.value) return c;
      return best;
    }, null);
    return Number(Number((chosen?.value ?? value)).toFixed(2));
  }

  if (mode === "down") {
    const chosen = candidates.reduce((best, c) => {
      if (c.value > value) return best;
      if (!best || c.value > best.value) return c;
      return best;
    }, null);
    const minTarget = Math.min(...targets, 0);
    const clamped = Math.max(chosen?.value ?? value, minTarget);
    return Number(Number(clamped).toFixed(2));
  }

  // nearest
  const chosen = candidates.reduce((best, c) => {
    if (!best) return c;
    if (c.delta < best.delta) return c;
    if (c.delta === best.delta) {
      // tie-break upward
      return c.value >= value ? c : best;
    }
    return best;
  }, null);
  return Number(Number((chosen?.value ?? value)).toFixed(2));
}

/**
 * calculateFinalPrice:
 * - amountUSD: number
 * - config: your config object where config.formula is an object mapping conditions to { multiplier, rounding }
 * - selectedGrade: optional string like "Ungraded" or "Grade 9.5"
 *
 * Returns: { converted, formulaResult, final, rounding, usedFormula }
 */
export async function calculateFinalPrice(
  amountUSD,
  config,
  selectedGrade = null,
  overrideFormula = null,
  applyFormula = true
) {
  if (!config) throw new Error("Missing configuration object.");
  if (typeof amountUSD !== "number" || isNaN(amountUSD)) {
    throw new Error("Invalid base price provided.");
  }

  // Use cached converter from src/utils/currency.js
  const converted = await convertUSD(amountUSD, config?.currency || "USD");

  // formulaTable is the object stored in settings.json under "formula"
  const formulaTable = (config && typeof config.formula === "object") ? config.formula : {};

  const normalizeEntry = (val) => {
    if (val && typeof val === "object") return val;
    if (typeof val === "string") return { multiplier: val };
    return { multiplier: "*1" };
  };

  const selectedEntry = normalizeEntry(selectedGrade ? formulaTable[selectedGrade] : null);
  const defaultEntry = normalizeEntry(formulaTable["Ungraded"]);
  const entry = overrideFormula
    ? { multiplier: overrideFormula, rounding: selectedEntry.rounding || defaultEntry.rounding || formulaTable.roundingDefault }
    : {
        multiplier: selectedEntry.multiplier || defaultEntry.multiplier || "*1",
        rounding: selectedEntry.rounding || defaultEntry.rounding || formulaTable.roundingDefault,
      };

  let formulaStr = entry.multiplier || "*1";

  let formulaResult = Number(converted);
  if (applyFormula && formulaStr) {
    formulaResult = applyPricingFormula(Number(converted), formulaStr);
  }

  const rounding = entry.rounding || null;
  let final = Number(Number(formulaResult).toFixed(2));
  if (rounding) {
    final = applyRounding(formulaResult, rounding);
  }

  return {
    converted,
    formulaResult: Number(Number(formulaResult).toFixed(2)),
    final,
    rounding,
    usedFormula: formulaStr,
  };
}
