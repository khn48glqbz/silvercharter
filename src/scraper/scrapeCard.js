// src/scraper/scrapeCard.js
import axios from "axios";
import * as cheerio from "cheerio";

/**
 * Scrapes PriceCharting for a card's price.
 * Returns { existing: false, name, price }.
 * No Shopify logic here.
 */
export default async function scrapeCard(urlInput) {
  let url = String(urlInput || "").trim();
  if (!url) {
    console.error("No URL provided.");
    return { existing: false, name: "Unknown Card", price: null };
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

      let priceText =
        $("td#used_price .price.js-price").first().text().trim() ||
        $("span.price.js-price").first().text().trim();

      if (!priceText) {
        console.warn("Price element not found. Returning null.");
        return { existing: false, name, price: null };
      }

      const numeric = parseFloat(priceText.replace(/[£$,]/g, ""));
      if (Number.isNaN(numeric)) {
        console.warn("Price parse failed:", priceText);
        return { existing: false, name, price: null };
      }

      return { existing: false, name, price: numeric };
    } catch (err) {
      console.warn(`Scrape attempt ${attempt} failed:`, err.message);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  return { existing: false, name: "Unknown Card", price: null };
}
