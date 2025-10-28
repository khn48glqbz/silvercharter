// src/utils/pricing.js
import axios from "axios";

/**
 * Convert USD -> target currency using Frankfurter API
 */
export async function convertFromUSD(amount, config) {
  const target = (config?.currency || "GBP").toUpperCase();
  if (target === "USD") return amount;

  try {
    const url = `https://api.frankfurter.app/latest?amount=${amount}&from=USD&to=${target}`;
    const res = await axios.get(url, { timeout: 10000 });
    const converted = res.data?.rates?.[target];
    return typeof converted === "number" ? converted : amount;
  } catch (err) {
    console.warn("Currency conversion failed; using original USD amount:", err.message);
    return amount;
  }
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

  const converted = await convertFromUSD(amountUSD, config);

  // formulaTable is the object stored in settings.json under "formula"
  const formulaTable = (config && typeof config.formula === "object") ? config.formula : {};

  // If the caller provided a specific grade/condition, prefer its mapping.
  // Otherwise, if config.formula is a plain string (legacy), use it.
  let formulaStr;
  if (selectedGrade && typeof formulaTable[selectedGrade] === "string") {
    formulaStr = formulaTable[selectedGrade];
  } else if (typeof config.formula === "string") {
    formulaStr = config.formula;
  } else {
    // fallback to Ungraded key if present, otherwise "*1"
    formulaStr = formulaTable["Ungraded"] || "*1";
  }

  const formulaResult = applyPricingFormula(converted, formulaStr);

  // roundTo99 read from the formulaTable object (so it remains grouped with formulas)
  const shouldRound = !!formulaTable.roundTo99;

  const final = shouldRound ? roundUpTo99(formulaResult) : Number(formulaResult.toFixed(2));

  return {
    converted,
    formulaResult: Number(formulaResult.toFixed(2)),
    final,
    roundTo99: shouldRound,
    usedFormula: formulaStr,
  };
}
