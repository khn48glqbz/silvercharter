import fs from "fs";
import inquirer from "inquirer";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();

const CONFIG_PATH = "./config.json";

// Load config
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          currency: "GBP", // default conversion currency
          pricing: { formula: "*1.0", roundTo99: false },
          shopify: { vendor: "The Pokemon Company", brand: "Pokemon", collection: "Singles" },
        },
        null,
        2
      )
    );
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH));
}

// Save config
function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Update .env
async function updateEnv() {
  const current = dotenv.config().parsed || {};

  const answers = await inquirer.prompt([
    { name: "SHOPIFY_STORE_URL", message: "Shopify Store URL:", default: current.SHOPIFY_STORE_URL || "" },
    { name: "SHOPIFY_ADMIN_TOKEN", message: "Admin API Token:", default: current.SHOPIFY_ADMIN_TOKEN || "" },
    { name: "SHOPIFY_API_KEY", message: "API Key (optional, for reference):", default: current.SHOPIFY_API_KEY || "" },
  ]);

  const envContent = Object.entries(answers)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.writeFileSync(".env", envContent);
  console.log(".env file updated successfully!\n");
}

// Scraper
async function scrapeCard(url) {
  console.log(`Scraping ${url}`);
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  const $ = cheerio.load(data);

  const name = $("#product_name").clone().children().remove().end().text().trim();
  const set = $("#product_name a").text().trim();
  const priceText = $("td#used_price .price.js-price").first().text().trim();

  if (!priceText) {
    console.log("Could not find price info.");
    return null;
  }

  const numeric = parseFloat(priceText.replace(/[£$,]/g, ""));
  return { name, set, price: numeric };
}

// === Currency conversion system ===
async function viewAvailableCurrencies() {
  try {
    const res = await axios.get("https://api.frankfurter.app/v1/currencies");
    console.log("Available currencies:");
    Object.entries(res.data).forEach(([code, name]) => {
      console.log(`${code}: ${name}`);
    });
  } catch (err) {
    console.error("Failed to fetch currencies:", err.message);
  }
}

async function setConversionCurrency(config) {
  const { currency } = await inquirer.prompt([
    { name: "currency", message: "Enter target currency code (e.g., GBP, USD, EUR):", default: config.currency },
  ]);
  config.currency = currency.toUpperCase();
  saveConfig(config);
  console.log(`Conversion currency set to ${config.currency}\n`);
}

async function convertFromUSD(amount, config) {
  const target = config.currency;
  if (target === "USD") return amount;

  try {
    const url = `https://api.frankfurter.app/latest?amount=${amount}&from=USD&to=${target}`;
    const res = await axios.get(url);
    return res.data.rates[target];
  } catch (err) {
    console.error("Currency conversion failed, using original amount:", err.message);
    return amount;
  }
}

// Pricing formula
function applyPricingFormula(price, config) {
  let finalPrice = price;

  const formula = config.pricing.formula;
  if (formula.startsWith("*")) finalPrice = price * parseFloat(formula.slice(1));
  else if (formula.startsWith("+")) finalPrice = price + parseFloat(formula.slice(1));

  if (config.pricing.roundTo99) {
    finalPrice = Math.ceil(finalPrice) - 0.01; // clean .99 rounding
    finalPrice = parseFloat(finalPrice.toFixed(2));
  }

  return finalPrice;
}

// Shopify importer
async function importToShopify(card, price, config, quantity = 1) {
  const { SHOPIFY_STORE_URL, SHOPIFY_ADMIN_TOKEN } = process.env;
  if (!SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_TOKEN) {
    console.log("Shopify credentials missing. Please set them in Settings first.");
    return;
  }

  const handle = `card-${Math.random().toString(36).substring(2, 8)}`;
  const productData = {
    product: {
      title: card.name,
      vendor: config.shopify.vendor,
      product_type: "Pokemon Card",
      handle: handle,
      status: "active",
      published_scope: "pos",
      variants: [
        {
          price: price.toFixed(2),
          inventory_management: "shopify",
          inventory_quantity: quantity,
          weight: 2,
          weight_unit: "g",
        },
      ],
      tags: [config.shopify.collection],
      metafields: [
        { namespace: "global", key: "expansion", value: card.set, type: "single_line_text_field" },
      ],
    },
  };

  try {
    await axios.post(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/products.json`,
      productData,
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, "Content-Type": "application/json" } }
    );
    console.log(`Imported ${quantity}x ${card.name} (${card.set}) at ${config.currency} ${price.toFixed(2)} each`);
  } catch (error) {
    console.error("Shopify import failed:", error.response?.data?.errors || error.message);
  }
}

// === Main menu ===
async function mainMenu() {
  const config = loadConfig();

  while (true) {
    const { choice } = await inquirer.prompt([
      { type: "list", name: "choice", message: "Main Menu", choices: ["Import cards", "Settings", "Exit"] },
    ]);

  if (choice === "Import cards") {
    while (true) {
      const { urlInput } = await inquirer.prompt([
        { name: "urlInput", message: 'Enter card URL (add *N for quantity, type "return" to go back, "exit" to quit):' },
      ]);

      const input = urlInput.trim().toLowerCase();
      if (input === "return") break;
      if (input === "exit") {
        console.log("Exiting...");
        process.exit(0);
      }

      // parse *N quantity suffix
      let url = urlInput.trim();
      let quantity = 1;
      const match = url.match(/\*(\d+)$/);
      if (match) {
        quantity = parseInt(match[1], 10);
        url = url.slice(0, match.index);
      }

      try {
        const card = await scrapeCard(url);
        if (!card) continue;

        const convertedPrice = await convertFromUSD(card.price, config);
        const retailPrice = applyPricingFormula(convertedPrice, config);
        await importToShopify(card, retailPrice, config, quantity);
      } catch (err) {
        console.error("Error importing card:", err.message);
      }
    }
  }

    if (choice === "Settings") await settingsMenu(config);
    if (choice === "Exit") {
      console.log("Exiting...");
      process.exit(0);
    }
  }
}

// === Settings menu ===
async function settingsMenu(config) {
  const { section } = await inquirer.prompt([
    {
      type: "list",
      name: "section",
      message: "Settings Menu",
      choices: ["Shopify Setup", "Pricing Settings", "Currency Conversion", "Return"],
    },
  ]);

  if (section === "Shopify Setup") {
    await updateEnv();
  } else if (section === "Pricing Settings") {
    const answers = await inquirer.prompt([
      { name: "formula", message: "Enter pricing formula (*1.2 or +2):", default: config.pricing.formula },
      { type: "confirm", name: "roundTo99", message: "Round prices to .99?", default: config.pricing.roundTo99 },
    ]);
    config.pricing = answers;
    saveConfig(config);
    console.log("Pricing settings updated.\n");
  } else if (section === "Currency Conversion") {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Currency Conversion",
        choices: ["View available currencies", "Set conversion currency", "Return"],
      },
    ]);

    if (action === "View available currencies") {
      await viewAvailableCurrencies();
    } else if (action === "Set conversion currency") {
      await setConversionCurrency(config);
    }
  }
}

// Start program
mainMenu();
