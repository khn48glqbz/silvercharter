// src/utils/pricing.js
import axios from "axios";

/**
 * Convert USD -> target currency using Frankfurter
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
 * Accepts formulas that start with an operator (e.g. "*1.2", "+3", "/2") or bare number (e.g. "1.2" -> treated as "*1.2").
 */
export function applyPricingFormula(base, formula) {
  if (typeof formula !== "string") return base;

  let f = formula.trim();

  // If user entered something like "1.2+3" (missing leading operator), assume multiply
  if (/^[0-9]/.test(f)) {
    f = `*${f}`;
  }

  // Only allow digits, operators, dots and parentheses (simple safety)
  const safe = f.replace(/[^0-9+\-*/().]/g, "");

  if (!/^[+\-*/]/.test(safe)) {
    console.warn(`Invalid formula format "${formula}", expected to start with + - * or /`);
    return base;
  }

  try {
    // Build expression by prepending the base
    // e.g. base=100, safe="*1.2+3" -> eval("100*1.2+3")
    // eslint-disable-next-line no-eval
    const result = eval(`${base}${safe}`);
    return typeof result === "number" && !isNaN(result) ? result : base;
  } catch (err) {
    console.warn("Error applying pricing formula:", err.message);
    return base;
  }
}

/**
 * Round up to nearest .99 if requested.
 * Examples:
 *  107.58 -> 107.99
 *  107.00 -> 107.99
 *  107.99 -> 107.99
 */
export function roundUpTo99(value) {
  if (typeof value !== "number" || isNaN(value)) return value;
  const cents = Math.round((value - Math.floor(value)) * 100);
  // If already ends with 99 cents, return
  if (cents === 99) return Number(value.toFixed(2));
  // Otherwise, round up to next whole, subtract 0.01
  const nextWhole = Math.ceil(value);
  return Number((nextWhole - 0.01).toFixed(2));
}

/**
 * calculateFinalPrice: returns { converted, formulaResult, final }
 * rounding to .99 is applied ONLY if config.pricing.roundTo99 === true
 */
export async function calculateFinalPrice(amountUSD, config) {
  if (!config) throw new Error("Missing configuration object.");
  if (typeof amountUSD !== "number" || isNaN(amountUSD)) {
    throw new Error("Invalid base price provided.");
  }

  const converted = await convertFromUSD(amountUSD, config);

  // Get formula from config (support both config.pricing.formula and config.pricingFormula)
  const formula = (config?.pricing?.formula) || config?.pricingFormula || "*1";

  const formulaResult = applyPricingFormula(converted, formula);

  const shouldRound = !!(config?.pricing?.roundTo99);
  const final = shouldRound ? roundUpTo99(formulaResult) : Number(formulaResult.toFixed(2));

  return { converted, formulaResult: Number(formulaResult.toFixed(2)), final, roundTo99: shouldRound };
}
