import axios from "axios";
import * as cheerio from "cheerio";

export default async function scrapeCard(urlInput) {
  let url = String(urlInput || "").trim();
  if (!url) {
    console.error("No URL provided.");
    return null;
  }
  // ensure protocol
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
      const html = res.data;
      const $ = cheerio.load(html);

      // Name (strip children of #product_name)
      const name =
        $("#product_name").clone().children().remove().end().text().trim() ||
        $("h1").first().text().trim();

      // Price
      let priceText = $("td#used_price .price.js-price").first().text().trim();
      if (!priceText) priceText = $("span.price.js-price").first().text().trim();

      if (!priceText) {
        console.warn("Page loaded but price selector not found. Snippet follows:");
        console.warn(String(html).slice(0, 1000));
        return null;
      }

      const numeric = parseFloat(priceText.replace(/[£$,]/g, ""));
      if (Number.isNaN(numeric)) {
        console.warn("Price parse returned NaN. priceText:", priceText);
        return null;
      }

      return { name, price: numeric };
    } catch (err) {
      const status = err.response?.status;
      const statusText = err.response?.statusText;
      const msg = status ? `HTTP ${status} ${statusText}` : err.message;
      console.warn(`Scrape attempt ${attempt} failed: ${msg}`);

      if (attempt === maxAttempts && err.response) {
        console.error("Final attempt response headers:", err.response.headers);
        const snippet = String(err.response.data || "").slice(0, 2000);
        console.error("Final attempt response body snippet:\n", snippet);
      }

      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}
