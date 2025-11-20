import inquirer from "inquirer";
import ora from "ora";
import { fetchAllPricechartingProducts } from "../../shopify/productSearch.js";
import {
  updateVariantPrice,
  setProductCondition,
  setInventoryQuantity,
  deleteProduct,
} from "../../shopify/productMutations.js";
import { logLabelSession } from "../helpers/labelLogger.js";
import { formatCurrency } from "../../utils/currency.js";
import { gridPrompt } from "../helpers/gridPrompt.js";

/**
 * Products menu
 * -------------
 * Fetches all products tied to PriceCharting URLs, applies filters + sorting in-memory,
 * and renders a spreadsheet-like grid.  Each product row exposes the most common edit
 * actions (price, quantity, condition) using the shared Shopify helpers.
 *
 * The grid prompt lives in `src/cli/helpers/gridPrompt.js` and uses per-column widths so
 * we can arrange the layout like a table without building a full TUI.
 */

const PAGE_SIZE = 15;
const CONDITION_CHOICES = ["Ungraded", "Damaged", "Grade 7", "Grade 8", "Grade 9", "Grade 9.5", "Grade 10"];
const singlesConditions = new Set(["Ungraded", "Damaged"]);
const SORT_CHOICES = [
  { name: "Date Added (Newest First)", key: "date", direction: "desc" },
  { name: "Date Added (Oldest First)", key: "date", direction: "asc" },
  { name: "Title (A → Z)", key: "title", direction: "asc" },
  { name: "Title (Z → A)", key: "title", direction: "desc" },
  { name: "Price (Low → High)", key: "price", direction: "asc" },
  { name: "Price (High → Low)", key: "price", direction: "desc" },
  { name: "Quantity (Low → High)", key: "quantity", direction: "asc" },
  { name: "Quantity (High → Low)", key: "quantity", direction: "desc" },
];

const deriveType = (condition) => (condition && singlesConditions.has(condition) ? "Singles" : "Slabs");

export default async function viewProducts(config) {
  const currency = (config?.currency || "USD").toUpperCase();
  const spinner = ora("Fetching products from Shopify...").start();
  let products;
  try {
    products = await fetchAllPricechartingProducts((count) => {
      spinner.text = `Fetching products… ${count} loaded`;
    });
    spinner.succeed(`Loaded ${products.length} products.`);
  } catch (err) {
    spinner.fail("Failed to fetch products");
    throw err;
  }

  let sortOption = { ...SORT_CHOICES[0] };
  products = sortProducts(
    products.map((prod) => ({ ...prod, currency })),
    sortOption
  );
  let filters = getDefaultFilters();
  let filtered = applyFilters(products, filters);
  let page = 0;

  while (true) {
    const action = await showPageMenu(filtered, filters, page, currency, sortOption);
    if (action.type === "product") {
      const product = filtered[action.index];
      if (!product) continue;
      await editProduct(product, currency, action.field || "price");
      if (product.removed) {
        products = products.filter((p) => !p.removed);
      }
      products = sortProducts(products, sortOption);
      filtered = applyFilters(products, filters);
      page = Math.min(page, Math.max(Math.ceil(filtered.length / PAGE_SIZE) - 1, 0));
      continue;
    }

    if (action.type === "next") {
      if ((page + 1) * PAGE_SIZE < filtered.length) page += 1;
    } else if (action.type === "prev") {
      if (page > 0) page -= 1;
    } else if (action.type === "filters") {
      filters = await promptFilters(products, filters);
      filtered = applyFilters(products, filters);
      if (!filtered.length) {
        console.log("No products match those filters. Resetting to all products.");
        filters = getDefaultFilters();
        filtered = applyFilters(products, filters);
      }
      page = 0;
    } else if (action.type === "sort") {
      sortOption = await promptSort(sortOption);
      products = sortProducts(products, sortOption);
      filtered = applyFilters(products, filters);
      page = 0;
    } else if (action.type === "search") {
      const removed = await searchProductsByTerm(filtered, currency);
      if (removed) products = products.filter((p) => !p.removed);
      products = sortProducts(products, sortOption);
      filtered = applyFilters(products, filters);
      page = Math.min(page, Math.max(Math.ceil(filtered.length / PAGE_SIZE) - 1, 0));
    } else if (action.type === "exit") {
      return;
    }
  }
}

function getDefaultFilters() {
  return {
    type: "All",
    condition: "All",
    language: "All",
    expansion: "",
    minQuantity: null,
    maxQuantity: null,
  };
}

function applyFilters(products, filters) {
  return products.filter((prod) => {
    if (prod.removed) return false;
    if (filters.type && filters.type !== "All" && prod.type !== filters.type) return false;
    if (filters.condition && filters.condition !== "All" && prod.condition !== filters.condition) return false;
    if (filters.expansion && !(prod.expansion || "").toLowerCase().includes(filters.expansion.toLowerCase())) return false;
    if (filters.language && filters.language !== "All" && prod.language !== filters.language) return false;
    if (filters.minQuantity != null && prod.inventoryQuantity != null && prod.inventoryQuantity < filters.minQuantity) return false;
    if (filters.maxQuantity != null && prod.inventoryQuantity != null && prod.inventoryQuantity > filters.maxQuantity) return false;
    return true;
  });
}

function formatProductLine(prod, currency) {
  const qty = prod.inventoryQuantity == null ? "?" : prod.inventoryQuantity;
  const retail = prod.price ? formatCurrency(prod.price, currency) : formatCurrency(0, currency);
  const original = formatOriginalValue(prod.pricechartingValue, currency);
  return `${prod.title} [${prod.condition || "Unknown"} | ${prod.type || "?"}] — ${retail} (${original}) | Qty: ${qty} | Set: ${prod.expansion || "Unknown"}`;
}

function formatOriginalValue(value, currency) {
  if (!value || value === "N/A") return "N/A";
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return formatCurrency(num, currency);
}

function formatPriceCell(prod, currency) {
  const retail = prod.price ? formatCurrency(prod.price, currency) : formatCurrency(0, currency);
  const originalNum = Number(prod.pricechartingValue);
  const originalValid = Number.isFinite(originalNum) && originalNum > 0;
  const originalLabel = originalValid ? formatCurrency(originalNum, currency) : "-";
  let markupLabel = "-";
  if (originalValid) {
    const priceNum = Number(prod.price) || 0;
    if (priceNum > 0) {
      const diff = ((priceNum - originalNum) / originalNum) * 100;
      markupLabel = `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%`;
    } else {
      markupLabel = "0%";
    }
  }
  return `${retail} | ${originalLabel} | ${markupLabel}`;
}

async function showPageMenu(products, filters, page, currency, sortOption) {
  const totalPages = Math.max(Math.ceil(products.length / PAGE_SIZE), 1);
  const start = page * PAGE_SIZE;
  const pageItems = products.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    const { selection } = await inquirer.prompt([
      {
        type: "list",
        name: "selection",
        message: "No products on this page. Choose an action:",
        choices: [
          { name: "Change filters", value: { type: "filters" } },
          { name: "Search products", value: { type: "search" } },
          { name: "Exit", value: { type: "exit" } },
        ],
      },
    ]);
    return selection;
  }

  const columns = 6;
  const placeholder = { name: " ", short: " ", value: { type: "noop" } };
  const disabledCell = (label) => ({ name: label, short: label, value: { type: "noop" } });
  const rows = [];
  const pushRow = (cells) => {
    const row = [...cells];
    while (row.length < columns) row.push({ ...placeholder });
    rows.push(row);
  };

  const summary = `Page ${page + 1}/${totalPages} — ${products.length} products total. Sort: ${sortOption?.name || SORT_CHOICES[0].name}`;

  const canNext = start + PAGE_SIZE < products.length;
  const canPrev = page > 0;
  pushRow([
    canNext ? { name: "Next", short: "Next", value: { type: "next" } } : disabledCell("Next"),
    canPrev ? { name: "Previous", short: "Previous", value: { type: "prev" } } : disabledCell("Previous"),
    { name: "Filters", short: "Filters", value: { type: "filters" } },
    { name: "Sort", short: "Sort", value: { type: "sort" } },
    { name: "Search", short: "Search", value: { type: "search" } },
    { name: "Exit", short: "Exit", value: { type: "exit" } },
  ]);
  for (let row = 0; row < pageItems.length; row += 1) {
    const prod = pageItems[row];
    const idx = start + row;
    const qty = prod.inventoryQuantity == null ? "?" : prod.inventoryQuantity;
    const priceLabel = formatPriceCell(prod, currency);
    const titleLabel = prod.title.length > 36 ? `${prod.title.slice(0, 33)}...` : prod.title;
    const expansionLabel =
      prod.expansion && prod.expansion.length > 30 ? `${prod.expansion.slice(0, 27)}...` : prod.expansion || "Unknown";

    pushRow([
      { name: titleLabel, short: prod.title, value: { type: "product", index: idx, field: "actions" } },
      {
        name: `${prod.type || "??"} | ${prod.condition || "Unknown"}`,
        short: `${prod.type || "??"} | ${prod.condition || "Unknown"}`,
        value: { type: "product", index: idx, field: "condition" },
      },
      {
        name: priceLabel,
        short: priceLabel,
        value: { type: "product", index: idx, field: "price" },
      },
      {
        name: `Quantity: ${qty}`,
        short: `Quantity: ${qty}`,
        value: { type: "product", index: idx, field: "quantity" },
      },
      {
        name: `${expansionLabel} | ${prod.language || "??"} | ${prod.expansionIcon ? "Icon" : "Blank"}`,
        short: `${expansionLabel} | ${prod.language || "??"} | ${prod.expansionIcon ? "Icon" : "Blank"}`,
        value: { type: "product", index: idx, field: "actions" },
      },
      {
        name: "Additional Options",
        short: "Additional Options",
        value: { type: "product", index: idx, field: "actions" },
      },
    ]);
  }

  const flatChoices = rows.flat();

  const columnWidths = [34, 20, 30, 14, 34, 20];

  while (true) {
    const selection = await gridPrompt(
      `${summary}\nSelect a product or action:`,
      rows.flat(),
      { columns, columnWidth: 32, columnWidths, exitValue: { type: "exit" } }
    );
    if (!selection || selection.type === "noop" || selection.type === "header") continue;
    return selection;
  }
}

async function editProduct(product, currency, preferredField) {
  let field = preferredField;
  if (!["price", "quantity", "condition", "actions"].includes(field)) field = "price";

  if (field === "price") {
    const { newPrice } = await inquirer.prompt([
      {
        name: "newPrice",
        message: `Enter new price (${product.price || 0}):`,
        validate: (input) => (!isNaN(parseFloat(input)) && parseFloat(input) >= 0) || "Enter a valid number",
      },
    ]);
    const rounded = Number(newPrice).toFixed(2);
    const spinner = ora("Updating price...").start();
    try {
      await updateVariantPrice(product.variantId, rounded);
      spinner.succeed("Price updated.");
      product.price = rounded;
      const qtyForLabels = product.inventoryQuantity == null ? 1 : Math.max(1, Number(product.inventoryQuantity));
      logLabelSession(product, qtyForLabels, "repricing");
    } catch (err) {
      spinner.fail("Failed to update price");
      console.error(err.message || err);
    }
  } else if (field === "quantity") {
    const currentQty = product.inventoryQuantity ?? 0;
    const { newQty } = await inquirer.prompt([
      {
        name: "newQty",
        message: `Set new quantity (current ${currentQty}):`,
        validate: (input) => Number.isInteger(Number(input)) || "Enter a whole number",
      },
    ]);
    const spinner = ora("Updating inventory...").start();
    try {
      await setInventoryQuantity(product.inventoryItemId, currentQty, Number(newQty));
      spinner.succeed("Inventory updated.");
      product.inventoryQuantity = Number(newQty);
    } catch (err) {
      spinner.fail("Failed to adjust inventory");
      console.error(err.message || err);
    }
  } else if (field === "condition") {
    const { newCondition } = await inquirer.prompt([
      { type: "list", name: "newCondition", message: "Select condition:", choices: CONDITION_CHOICES, default: product.condition || "Ungraded" },
    ]);
    const newType = deriveType(newCondition);
    const spinner = ora("Updating condition...").start();
    try {
      await setProductCondition(product.id, {
        sourceUrl: product.sourceUrl,
        condition: newCondition,
        type: newType,
        game: product.game,
        expansion: product.expansion,
        language: product.language,
      });
      spinner.succeed("Condition updated.");
      const qtyForLabels = product.inventoryQuantity == null ? 1 : Math.max(1, Number(product.inventoryQuantity));
      logLabelSession(product, qtyForLabels, "repricing");
      const prevType = product.type;
      product.condition = newCondition;
      product.type = newType;
      if (prevType !== newType) {
        console.log("Note: update Shopify collections to reflect Singles/Slabs change.");
      }
    } catch (err) {
      spinner.fail("Failed to update condition");
      console.error(err.message || err);
    }
  } else if (field === "actions") {
    const { action } = await inquirer.prompt([
      { type: "list", name: "action", message: "Actions", choices: ["Remove product", "Cancel"] },
    ]);
    if (action === "Remove product") {
      const { confirmRemove } = await inquirer.prompt([
        { type: "confirm", name: "confirmRemove", message: `Delete ${product.title}?`, default: false },
      ]);
      if (!confirmRemove) return;
      const spinner = ora("Deleting product...").start();
      try {
        await deleteProduct(product.id);
        spinner.succeed("Product deleted.");
        product.removed = true;
      } catch (err) {
        spinner.fail("Failed to delete product");
        console.error(err.message || err);
      }
    }
  }
}

function sortProducts(list, option) {
  if (!option) return [...list];
  const dir = option.direction === "desc" ? -1 : 1;
  const key = option.key;
  return [...list].sort((a, b) => {
    const av = getSortValue(a, key);
    const bv = getSortValue(b, key);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function getSortValue(product, key) {
  if (key === "price") return Number(product.price) || 0;
  if (key === "quantity") return Number(product.inventoryQuantity) || 0;
  if (key === "date") return product.createdAt ? product.createdAt.getTime() : 0;
  return (product.title || "").toLowerCase();
}

async function promptSort(currentOption) {
  const { selection } = await inquirer.prompt([
    {
      type: "list",
      name: "selection",
      message: "Sort products by:",
      choices: SORT_CHOICES.map((choice) => ({
        name: choice.name,
        value: choice,
      })),
      default: currentOption?.name || SORT_CHOICES[0].name,
    },
  ]);
  return { ...selection };
}

async function promptFilters(products, current) {
  const typeChoices = ["All", ...collectDistinctValues(products, "type")];
  const conditionChoices = ["All", ...collectDistinctValues(products, "condition")];
  const languageChoices = ["All", ...collectDistinctValues(products, "language")];

  const baseAnswers = await inquirer.prompt([
    { type: "list", name: "type", message: "Filter by type:", choices: typeChoices.length ? typeChoices : ["All"], default: current.type || "All" },
    { type: "list", name: "condition", message: "Filter by condition:", choices: conditionChoices.length ? conditionChoices : ["All"], default: current.condition || "All" },
    { type: "list", name: "language", message: "Filter by language:", choices: languageChoices.length ? languageChoices : ["All"], default: current.language || "All" },
  ]);

  const { expansion } = await inquirer.prompt([
    { name: "expansion", message: "Filter by expansion substring (leave blank for all):", default: current.expansion || "" },
  ]);

  const quantityAnswers = await inquirer.prompt([
    {
      type: "input",
      name: "minQuantity",
      message: "Minimum quantity (leave blank for none):",
      default: current.minQuantity ?? "",
      validate: (input) => input === "" || (!Number.isNaN(Number(input)) && Number(input) >= 0) || "Enter a positive number",
    },
    {
      type: "input",
      name: "maxQuantity",
      message: "Maximum quantity (leave blank for none):",
      default: current.maxQuantity ?? "",
      validate: (input) => input === "" || (!Number.isNaN(Number(input)) && Number(input) >= 0) || "Enter a positive number",
    },
  ]);

  return {
    type: baseAnswers.type,
    condition: baseAnswers.condition,
    language: baseAnswers.language,
    expansion: expansion.trim(),
    minQuantity: quantityAnswers.minQuantity === "" ? null : Number(quantityAnswers.minQuantity),
    maxQuantity: quantityAnswers.maxQuantity === "" ? null : Number(quantityAnswers.maxQuantity),
  };
}

function collectDistinctValues(products, key) {
  return Array.from(new Set(products.map((p) => p[key]).filter(Boolean))).sort();
}

async function searchProductsByTerm(products, currency) {
  if (!products.length) {
    console.log("No products available.");
    return false;
  }
  const { term } = await inquirer.prompt([{ name: "term", message: "Enter search term (blank to cancel):", default: "" }]);
  const query = term.trim().toLowerCase();
  if (!query) return false;
  const matches = products.filter((prod) =>
    [prod.title, prod.expansion, prod.condition, prod.barcode].some((value) => (value || "").toLowerCase().includes(query))
  );
  if (!matches.length) {
    console.log("No products matched that term.");
    return false;
  }
  console.log(`Found ${matches.length} matching products. Showing first 20.`);
  matches.slice(0, 20).forEach((prod, idx) => {
    console.log(`${idx + 1}. ${formatProductLine(prod, currency)}`);
  });
  const { pick } = await inquirer.prompt([
    {
      name: "pick",
      message: "Select product number to edit (leave blank to cancel):",
      validate: (input) => {
        if (!input.trim()) return true;
        const idx = Number(input);
        return idx >= 1 && idx <= Math.min(matches.length, 20) ? true : "Enter a valid number from the list.";
      },
    },
  ]);
  if (!pick.trim()) return false;
  const idx = Number(pick) - 1;
  const selected = matches[idx];
  if (!selected) return false;
  const { field } = await inquirer.prompt([
    {
      type: "list",
      name: "field",
      message: "What would you like to edit?",
      choices: [
        { name: "Retail price", value: "price" },
        { name: "Quantity", value: "quantity" },
        { name: "Condition", value: "condition" },
        { name: "Remove product", value: "actions" },
        { name: "Cancel", value: "cancel" },
      ],
    },
  ]);
  if (field === "cancel") return false;
  await editProduct(selected, currency, field);
  return !!selected.removed;
}
