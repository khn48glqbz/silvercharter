// src/utils/pricing.js
import { convertUSD } from "./currency.js";

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
 * Round up to nearest .99 (e.g. 107.58 → 107.99)
 */
export function roundUpTo99(value) {
  if (typeof value !== "number" || isNaN(value)) return value;
  const cents = Math.round((value - Math.floor(value)) * 100);
  if (cents === 99) return Number(value.toFixed(2));
  const nextWhole = Math.ceil(value);
  return Number((nextWhole - 0.01).toFixed(2));
}

/**
 * Round down to nearest .99 below the value.
 * Examples:
 *  1.89 -> 0.99
 *  2.00 -> 1.99
 *  3.74 -> 2.99
 * Minimum enforced: 0.99
 */
export function roundDownTo99(value) {
  if (typeof value !== "number" || isNaN(value)) return value;
  const cents = Math.round((value - Math.floor(value)) * 100);
  if (cents === 99) return Number(value.toFixed(2));
  const floored = Math.floor(value);
  const candidate = (floored - 1) + 0.99;
  return Number(Math.max(0.99, Number(candidate.toFixed(2))).toFixed(2));
}

/**
 * Retrieve the pricing formula string for a given grade/condition.
 * Falls back to "*1" if not found.
 */
export function getFormulaForCondition(condition, config) {
  const table = config?.formula || {};
  const entry = table[condition];
  return typeof entry === "string" ? entry : "*1";
}

/**
 * calculateFinalPrice:
 * - amountUSD: number
 * - config: your config object where config.formula is an object (mapping) that also contains roundTo99
 * - selectedGrade: optional string like "Ungraded" or "Grade 9.5"
 *
 * Returns: { converted, formulaResult, final, roundTo99, usedFormula }
 */
export async function calculateFinalPrice(amountUSD, config, selectedGrade = null) {
  if (!config) throw new Error("Missing configuration object.");
  if (typeof amountUSD !== "number" || isNaN(amountUSD)) {
    throw new Error("Invalid base price provided.");
  }

  // Use cached converter from src/utils/currency.js
  const converted = await convertUSD(amountUSD, config?.currency || "USD");

  // formulaTable is the object stored in settings.json under "formula"
  const formulaTable = (config && typeof config.formula === "object") ? config.formula : {};

  // Determine which formula string to use
  let formulaStr;
  if (selectedGrade && typeof formulaTable[selectedGrade] === "string") {
    formulaStr = formulaTable[selectedGrade];
  } else if (typeof config.formula === "string") {
    // legacy handling (unlikely with new canonical structure)
    formulaStr = config.formula;
  } else {
    formulaStr = formulaTable["Ungraded"] || "*1";
  }

  const formulaResult = applyPricingFormula(Number(converted), formulaStr);

  // roundTo99 read from the formulaTable object (so it remains grouped with formulas)
  const shouldRound = !!formulaTable.roundTo99;

  // Special handling for Damaged condition: round DOWN to .99 (customer request)
  let final;
  if (selectedGrade === "Damaged") {
    final = roundDownTo99(formulaResult);
  } else if (shouldRound) {
    final = roundUpTo99(formulaResult);
  } else {
    final = Number(Number(formulaResult).toFixed(2));
  }

  return {
    converted,
    formulaResult: Number(Number(formulaResult).toFixed(2)),
    final,
    roundTo99: shouldRound,
    usedFormula: formulaStr,
  };
}
