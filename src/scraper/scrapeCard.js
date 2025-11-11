// src/scraper/scrapeCard.js
import axios from "axios";
import * as cheerio from "cheerio";

const CONDITION_SELECTORS = {
  Ungraded: "td#used_price",
  "Grade 7": "td#complete_price",
  "Grade 8": "td#new_price",
  "Grade 9": "td#graded_price",
  "Grade 9.5": "td#box_only_price",
  "Grade 10": "td#manual_only_price",
};

function parsePrice(rawText) {
  if (!rawText) return null;
  const trimmed = rawText.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed === "-" || trimmed.toLowerCase() === "n/a") return null;
  const numeric = parseFloat(trimmed.replace(/[^0-9.,-]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function extractPrice($, selector) {
  if (!selector) return null;
  const cell = $(selector);
  if (!cell.length) return null;
  const priceText = cell.find(".price.js-price").first().text();
  return parsePrice(priceText);
}

/**
 * Scrapes PriceCharting for a card's price(s).
 * Returns { existing: false, name, price, prices }.
 * - price: legacy field (Ungraded value if present)
 * - prices: map of condition -> numeric price or null
 */
export default async function scrapeCard(urlInput) {
  let url = String(urlInput || "").trim();
  if (!url) {
    console.error("No URL provided.");
    return { existing: false, name: "Unknown Card", price: null, prices: {} };
  }

  if (!/^https?:\/\//i.test(url)) url = "https://" + url.replace(/^\/+/, "");

  console.log(`Scraping ${url}`);

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    Referer: "https://www.pricecharting.com/",
    Connection: "keep-alive",
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.get(url, { headers, timeout: 15000 });
      const $ = cheerio.load(res.data);

      const name =
        $("#product_name").clone().children().remove().end().text().trim() ||
        $("h1").first().text().trim() ||
        "Unknown Card";

      const prices = {};
      for (const [condition, selector] of Object.entries(CONDITION_SELECTORS)) {
        prices[condition] = extractPrice($, selector);
      }

      if (prices.Ungraded == null) {
        const fallback = $("span.price.js-price").first().text();
        prices.Ungraded = parsePrice(fallback);
      }

      const legacyPrice = prices.Ungraded ?? null;

      return { existing: false, name, price: legacyPrice, prices };
    } catch (err) {
      console.warn(`Scrape attempt ${attempt} failed:`, err.message);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  return { existing: false, name: "Unknown Card", price: null, prices: {} };
}
