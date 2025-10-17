  // #!/usr/bin/env node
  import fs from "fs";
  import path from "path";
  import inquirer from "inquirer";
  import dotenv from "dotenv";
  import axios from "axios";
  import * as cheerio from "cheerio";

  dotenv.config();

  // ===== Constants & Paths =====
  const CONFIG_PATH = "./config.json";
  const LABELS_DIR = "./labels";

  // ===== Config helpers =====
  function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify(
          {
            currency: "GBP",
            pricing: { formula: "*1.0", roundTo99: false },
            shopify: { vendor: "The Pokemon Company", collection: "Singles" },
          },
          null,
          2
        )
      );
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  }
  function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  // ===== .env update helper =====
  async function updateEnv() {
    const current = dotenv.config().parsed || {};
    const answers = await inquirer.prompt([
      {
        name: "SHOPIFY_STORE_URL",
        message: "Shopify Store URL (hostname, e.g. yourshop.myshopify.com) - do NOT include protocol:",
        default: current.SHOPIFY_STORE_URL || process.env.SHOPIFY_STORE_URL || "",
      },
      {
        name: "SHOPIFY_ADMIN_TOKEN",
        message: "Admin API Token (X-Shopify-Access-Token):",
        default: current.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN || "",
      },
      {
        name: "POS_PUBLICATION_ID",
        message: "POS Publication ID (optional; leave blank to auto-detect):",
        default: current.POS_PUBLICATION_ID || process.env.POS_PUBLICATION_ID || "",
      },
    ]);
    const content = Object.entries(answers).map(([k, v]) => `${k}=${v}`).join("\n");
    fs.writeFileSync(".env", content, "utf8");
    console.log(".env updated. Note: changes take effect after restarting the script or calling dotenv.config().");
    dotenv.config();
  }

  // ===== Scraper (robust) =====
  async function scrapeCard(urlInput) {
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
        const name = $("#product_name").clone().children().remove().end().text().trim() || $("h1").first().text().trim();

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

  // ===== Currency conversion via Frankfurter =====
  async function convertFromUSD(amount, config) {
    const target = (config && config.currency) ? config.currency : "GBP";
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

  // ===== Pricing formula =====
  function applyPricingFormula(price, config) {
    let finalPrice = Number(price);
    const formula = config?.pricing?.formula || "*1.0";
    if (formula.startsWith("*")) finalPrice = finalPrice * parseFloat(formula.slice(1));
    else if (formula.startsWith("+")) finalPrice = finalPrice + parseFloat(formula.slice(1));
    if (config?.pricing?.roundTo99) {
      finalPrice = Math.ceil(finalPrice) - 0.01;
    }
    return Number(finalPrice.toFixed(2));
  }

  // ===== CSV helpers =====
  function makeNumericSessionId() {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    return `${yyyy}${mm}${dd}${hh}${mi}${ss}${ms}`;
  }
  function ensureLabelsDir() {
    if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR, { recursive: true });
  }
  function createSessionCSV(sessionId) {
    ensureLabelsDir();
    const filePath = path.join(LABELS_DIR, `session${sessionId}.csv`);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "Date,Price,Name,Grade\n", "utf8");
    return filePath;
  }
  function appendCsvRows(filePath, dateOnly, priceStr, name, grade, quantity) {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    let out = "";
    for (let i = 0; i < quantity; i++) {
      out += [esc(dateOnly), esc(priceStr), esc(name), esc(grade || "")].join(",") + "\n";
    }
    fs.appendFileSync(filePath, out, "utf8");
  }

  // ===== Shopify helper utilities =====
  function buildShopifyBase() {
    const raw = (process.env.SHOPIFY_STORE_URL || "").trim();
    if (!raw) return null;
    return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
  }
  function getShopifyToken() {
    return (process.env.SHOPIFY_ADMIN_TOKEN || "").trim();
  }

  async function getPosPublicationIdAuto() {
    const base = buildShopifyBase();
    const token = getShopifyToken();
    if (!base || !token) return null;
    try {
      const res = await axios.get(`${base}/admin/api/2024-07/publications.json`, {
        headers: { "X-Shopify-Access-Token": token, Accept: "application/json" },
        timeout: 10000,
      });
      const pubs = res.data?.publications || [];
      const pos = pubs.filter((p) => String(p.name).toLowerCase() === "point of sale");
      if (pos.length === 0) return null;
      pos.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return pos[0].id;
    } catch (err) {
      console.warn("Could not auto-detect POS publication id:", err.response?.status, err.response?.data || err.message);
      return null;
    }
  }

  // ===== Helper: GraphQL POST =====
  async function graphqlPost(body) {
    const base = buildShopifyBase();
    const token = getShopifyToken();
    if (!base || !token) throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN in environment.");

    const url = `${base}/admin/api/2024-07/graphql.json`;
    const res = await axios.post(url, body, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 15000,
    });
    return res.data;
  }

  // ===== GraphQL / Shopify helper =====
async function createDraftAndPublishToPos({ title, price, quantity, sourceUrl }, config) {
  const base = buildShopifyBase();
  const token = getShopifyToken();
  if (!base || !token) throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN.");

  let productId = null;
  let inventoryItemId = null;
  let isNewProduct = false;

  // ----- 1) Try to find existing product by metafield -----
  try {
    const query = {
      query: `
        query {
          products(first: 1, query: "metafields.pricecharting.source_url:\\"${sourceUrl}\\"") {
            edges {
              node {
                id
                title
                variants(first: 1) {
                  edges {
                    node {
                      id
                      inventoryItem { id }
                    }
                  }
                }
              }
            }
          }
        }
      `
    };
    const res = await graphqlPost(query);
    const existingEdge = res?.data?.products?.edges?.[0];
    if (existingEdge) {
      productId = existingEdge.node.id;
      inventoryItemId = existingEdge.node.variants?.edges?.[0]?.node?.inventoryItem?.id.match(/\/InventoryItem\/(\d+)$/)?.[1] || null;
      console.log("Existing product found:", existingEdge.node.title, productId);
    }
  } catch (err) {
    console.warn("Failed to query existing product:", err.message || err);
  }

  // ----- 2) If not found, create new product -----
  if (!productId) {
    const payload = {
      product: {
        title,
        vendor: config?.shopify?.vendor || "The Pokemon Company",
        product_type: "Pokemon Card",
        status: "draft",
        variants: [
          {
            price: Number(price).toFixed(2),
            inventory_management: "shopify",
            inventory_quantity: 0, // start at 0, adjust later
            weight: 2,
            weight_unit: "g",
          }
        ],
        tags: [config?.shopify?.collection || "Singles"],
      }
    };

    try {
      const createRes = await axios.post(`${base}/admin/api/2024-07/products.json`, payload, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      });
      const product = createRes.data?.product;
      productId = product?.id;
      inventoryItemId = product?.variants?.[0]?.inventory_item_id;
      isNewProduct = true;
      console.log(`Created new draft product ${title} (id: ${productId})`);
    } catch (err) {
      console.error("Product creation failed:", err.response?.status, err.response?.data || err.message);
      throw err;
    }
  }

  // ----- 3) Adjust inventory (for new or existing product) -----
  if (inventoryItemId && quantity > 0) {
    try {
      const locationsRes = await axios.get(`${base}/admin/api/2024-07/locations.json`, {
        headers: { "X-Shopify-Access-Token": token },
      });
      const locationId = locationsRes.data?.locations?.[0]?.id;
      if (!locationId) throw new Error("No Shopify location found for inventory adjustment");

      const adjBody = {
        inventory_item_id: Number(inventoryItemId),
        location_id: Number(locationId),
        available_adjustment: Number(quantity),
      };
      const adjRes = await axios.post(`${base}/admin/api/2024-07/inventory_levels/adjust.json`, adjBody, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      });
      console.log("Inventory adjusted:", adjRes.data);
    } catch (err) {
      console.error("Inventory adjust failed:", err.response?.status, err.response?.data || err.message);
    }
  }

  // ----- 4) Attach / update metafield -----
  try {
    const ownerId = `gid://shopify/Product/${productId}`;
    const metaGql = {
      query: `
        mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id namespace key value }
            userErrors { field message }
          }
        }
      `,
      variables: {
        metafields: [
          {
            namespace: "pricecharting",
            key: "source_url",
            type: "single_line_text_field",
            value: sourceUrl,
            ownerId,
          }
        ],
      }
    };
    const metaRes = await graphqlPost(metaGql);
    const errors = metaRes?.data?.metafieldsSet?.userErrors;
    if (errors?.length) console.warn("Metafield errors:", JSON.stringify(errors, null, 2));
    else console.log(`Metafield pricecharting.source_url set on product ${productId}`);
  } catch (err) {
    console.warn("Failed to set metafield:", err.response?.status, err.response?.data || err.message);
  }

  // ----- 5) Return clean info -----
  return {
    productId,
    inventoryItemId,
    isNewProduct,
  };
}

  // ===== Main menu & flow =====
  async function mainMenu() {
    const config = loadConfig();
    const sessionId = makeNumericSessionId();
    const csvPath = createSessionCSV(sessionId);
    console.log(`Session CSV: ${csvPath}`);

    // Try to get POS publication id from env or auto-detect (not required)
    let posPublicationId = process.env.POS_PUBLICATION_ID || null;
    if (!posPublicationId) {
      try {
        posPublicationId = await getPosPublicationIdAuto();
        if (posPublicationId) console.log(`Detected POS publication id: ${posPublicationId}`);
      } catch (err) {
        // ignore
      }
    }

    while (true) {
      const { choice } = await inquirer.prompt([{ type: "list", name: "choice", message: "Main Menu", choices: ["Import cards", "Settings", "Exit"] }]);
      if (choice === "Import cards") {
        while (true) {
          const { urlInput } = await inquirer.prompt([{ name: "urlInput", message: 'Enter card URL (add *N for quantity, "return" to go back, "exit" to quit):' }]);
          const raw = (urlInput || "").trim();
          if (!raw) continue;
          const lower = raw.toLowerCase();
          if (lower === "return") break;
          if (lower === "exit") {
            console.log("Session finished. CSV saved to:", csvPath);
            process.exit(0);
          }

          // parse quantity suffix without lowercasing the URL
          let url = raw;
          let qty = 1;
          const m = url.match(/\*(\d+)$/);
          if (m) {
            qty = parseInt(m[1], 10) || 1;
            url = url.slice(0, m.index);
          }

          try {
            await handleImportUrl(url, qty, config, csvPath, posPublicationId);
          } catch (err) {
            console.error("Error importing card:", err.message || err);
          }
        }
      } else if (choice === "Settings") {
        await settingsMenu(config);
      } else if (choice === "Exit") {
        console.log("Exiting — session CSV:", csvPath);
        process.exit(0);
      }
    }
  }

  // ===== Handle Import URL =====
  async function handleImportUrl(url, quantity, config, csvPath, posPublicationIdArg) {
    const scraped = await scrapeCard(url);
    if (!scraped) {
      console.error(`Failed to scrape ${url}`);
      return;
    }

    const { name, price } = scraped;
    const converted = await convertFromUSD(price, config);
    const finalPrice = applyPricingFormula(converted, config);

    const now = new Date();
    const dateOnly = now.toISOString().slice(0, 10);
    const priceStr = `${config.currency || "GBP"} ${finalPrice.toFixed(2)}`;
    appendCsvRows(csvPath, dateOnly, priceStr, name, "", quantity);

    console.log(`Uploading ${name} (${quantity}x) — ${priceStr}`);

    try {
      const result = await createDraftAndPublishToPos(
        { title: name, price: finalPrice, quantity, sourceUrl: url },
        config,
        posPublicationIdArg
      );

      if (result.updated) {
        console.log(`✔ Updated inventory for ${name}`);
      } else if (result.method === "created_with_metafield") {
        console.log(`✔ Created new product with metafield: ${name}`);
      } else {
        console.log(`⚠ Product created as draft (reason: ${result.reason || "unknown"})`);
      }
    } catch (err) {
      console.error(`Import error: ${err.message || err}`);
    }
  }

  // ===== Start =====
  mainMenu();
