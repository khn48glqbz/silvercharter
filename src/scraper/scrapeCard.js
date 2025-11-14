// src/scraper/scrapeCard.js
import axios from "axios";
import * as cheerio from "cheerio";
import { getVendorsMap, getLanguagesMap } from "../utils/staticData.js";

const CONDITION_SELECTORS = {
  Ungraded: "td#used_price",
  "Grade 7": "td#complete_price",
  "Grade 8": "td#new_price",
  "Grade 9": "td#graded_price",
  "Grade 9.5": "td#box_only_price",
  "Grade 10": "td#manual_only_price",
};

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function deriveSetMetadata(rawSetText = "") {
  const vendors = getVendorsMap();
  const languages = getLanguagesMap();
  const normalized = rawSetText.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return {
      setLabel: "",
      game: "Unknown Game",
      vendor: "Unknown Vendor",
      languageName: "English",
      languageCode: "EN",
      expansion: "Unknown Expansion",
    };
  }

  const vendorEntries = Object.entries(vendors || {}).sort((a, b) => b[0].length - a[0].length);
  let game = normalized.split(" ")[0] || "Unknown Game";
  let vendor = vendors?.[game] || game;
  let remainder = normalized;

  for (const [name, vendorName] of vendorEntries) {
    const regex = new RegExp(`^${escapeRegExp(name)}\\b`, "i");
    const match = remainder.match(regex);
    if (match) {
      game = name;
      vendor = vendorName || name;
      remainder = remainder.slice(match[0].length).trim();
      break;
    }
  }

  if (!vendor) vendor = game || "Unknown Vendor";
  if (!remainder) remainder = "";

  const languageEntries = Object.entries(languages || {}).sort((a, b) => b[0].length - a[0].length);
  let languageName = "English";
  let languageCode = "EN";

  const tokens = remainder.split(/\s+/).filter(Boolean);
  for (const [langName, langCode] of languageEntries) {
    const lowerName = langName.toLowerCase();
    const matchToken = tokens.find((token) => {
      const lowerToken = token.toLowerCase();
      return lowerToken === lowerName || lowerToken.startsWith(lowerName);
    });
    if (matchToken) {
      languageName = langName;
      languageCode = langCode || langName.slice(0, 2).toUpperCase();
      remainder = tokens
        .filter((token) => token !== matchToken)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      break;
    }
  }

  const expansion = remainder || "Unknown Expansion";

  return {
    setLabel: normalized,
    game,
    vendor,
    languageName,
    languageCode,
    expansion,
  };
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

      let setLabel = "";
      let metadata = null;
      let iconData = null;

      const productSetLink = $("#product_name a").first();
      if (productSetLink.length) {
        const linkClone = productSetLink.clone();
        const img = linkClone.find("img.set-logo").first();
        if (img.length) {
          const src = img.attr("src") || "";
          const filename = (src.split("/").pop() || "").trim();
          if (filename) {
            const absoluteUrl = /^https?:\/\//i.test(src) ? src : `https://www.pricecharting.com${src}`;
            iconData = { filename, src, url: absoluteUrl };
          }
        }
        linkClone.children("img").remove();
        setLabel = linkClone.text().trim();
      }

      if (!setLabel) {
        const breadcrumbSet = $(".breadcrumbs .crumbs a").last();
        if (breadcrumbSet.length) {
          setLabel = breadcrumbSet.clone().children().remove().end().text().trim();
        }
      }

      if (!setLabel) {
        const logoAnchor = $("a:has(img.set-logo)").first();
        if (logoAnchor.length) {
          const img = logoAnchor.find("img.set-logo").first();
          if (img.length) {
            const src = img.attr("src") || "";
            const filename = (src.split("/").pop() || "").trim();
            if (filename) {
              const absoluteUrl = /^https?:\/\//i.test(src) ? src : `https://www.pricecharting.com${src}`;
              iconData = { filename, src, url: absoluteUrl };
            }
          }
          setLabel = logoAnchor.clone().children().remove().end().text().trim();
        }
      }

      if (!setLabel) {
        const fallbackSet = $('#product_details a[href*="/console/"]').first().text();
        setLabel = fallbackSet.trim();
      }

      metadata = deriveSetMetadata(setLabel);
      metadata.icon = iconData;

      const legacyPrice = prices.Ungraded ?? null;

      return {
        existing: false,
        name,
        price: legacyPrice,
        prices,
        metadata,
      };
    } catch (err) {
      console.warn(`Scrape attempt ${attempt} failed:`, err.message);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  return {
    existing: false,
    name: "Unknown Card",
    price: null,
    prices: {},
      metadata: {
        setLabel: "",
        game: "Unknown Game",
        vendor: "Unknown Vendor",
        languageName: "English",
        languageCode: "EN",
        expansion: "Unknown Expansion",
        icon: null,
      },
  };
}
