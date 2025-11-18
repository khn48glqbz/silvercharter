// src/utils/currency.js
import fs from "fs/promises";
import path from "path";
import axios from "axios";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_PATH = path.join(DATA_DIR, "currency.json");
const FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=USD";
const SYMBOL_MAP = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  JPY: "¥",
  CNY: "¥",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF ",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  NZD: "NZ$",
  INR: "₹",
  KRW: "₩",
  TRY: "₺",
  RUB: "₽",
  BRL: "R$",
  MXN: "MX$",
  HKD: "HK$",
  SGD: "S$",
  ZAR: "R",
  THB: "฿",
};

/**
 * initCurrencyCache()
 * - Attempts to fetch latest rates from Frankfurter and store them to data/currency.json.
 * - If the network call fails, leaves existing cache as-is (if present).
 * - This function is best-effort and should be called once at startup.
 */
export async function initCurrencyCache() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const res = await axios.get(FRANKFURTER_URL, { timeout: 10000 });
    const data = res.data || {};
    const toWrite = {
      lastUpdated: new Date().toISOString(),
      rates: data.rates || {},
    };
    await fs.writeFile(CACHE_PATH, JSON.stringify(toWrite, null, 2), "utf8");
    console.log("Currency rates cached.");
    return toWrite;
  } catch (err) {
    // best-effort: log and continue, we'll use cached file if present
    console.warn("Could not refresh currency rates:", err.message);
    try {
      const existing = JSON.parse(await fs.readFile(CACHE_PATH, "utf8"));
      console.log(`Using cached currency data from ${existing.lastUpdated}`);
      return existing;
    } catch (err2) {
      console.warn("No currency cache available.");
      return null;
    }
  }
}

/**
 * convertUSD(value, targetCurrency)
 * - Reads cached rates from data/currency.json and returns value converted from USD.
 * - If no cached rate is found for the targetCurrency, returns the original value.
 */
export async function convertUSD(value, targetCurrency = "USD") {
  if (typeof value !== "number" || isNaN(value)) return value;
  const tgt = (targetCurrency || "USD").toUpperCase();
  if (tgt === "USD") return value;

  try {
    const cacheRaw = await fs.readFile(CACHE_PATH, "utf8");
    const cache = JSON.parse(cacheRaw);
    const rate = cache?.rates?.[tgt];
    if (typeof rate !== "number") {
      console.warn(`No cached rate for ${tgt}; returning original USD value.`);
      return value;
    }
    return value * rate;
  } catch (err) {
    console.warn("Failed to read currency cache; returning original USD value.");
    return value;
  }
}

export async function convertToUSD(value, sourceCurrency = "USD") {
  if (typeof value !== "number" || isNaN(value)) return value;
  const src = (sourceCurrency || "USD").toUpperCase();
  if (src === "USD") return value;

  try {
    const cacheRaw = await fs.readFile(CACHE_PATH, "utf8");
    const cache = JSON.parse(cacheRaw);
    const rate = cache?.rates?.[src];
    if (typeof rate !== "number" || rate === 0) {
      console.warn(`No cached rate for ${src}; returning original value.`);
      return value;
    }
    return value / rate;
  } catch (err) {
    console.warn("Failed to read currency cache; returning original value.");
    return value;
  }
}

export function formatCurrency(value, currency = "USD") {
  const symbol = SYMBOL_MAP[currency.toUpperCase()] || `${currency} `;
  return `${symbol}${Number(value).toFixed(2)}`;
}
