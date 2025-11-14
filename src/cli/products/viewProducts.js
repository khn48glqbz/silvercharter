import inquirer from "inquirer";
import { fetchAllPricechartingProducts } from "../../shopify/productSearch.js";
import { updateVariantPrice, setProductCondition, setInventoryQuantity, deleteProduct } from "../../shopify/productMutations.js";
import { logLabelSession } from "../helpers/labelLogger.js";
import { formatCurrency } from "../../utils/currency.js";

const PAGE_SIZE = 15;
const CONDITION_CHOICES = ["Ungraded", "Damaged", "Grade 7", "Grade 8", "Grade 9", "Grade 9.5", "Grade 10"];
const singlesConditions = new Set(["Ungraded", "Damaged"]);

const deriveType = (condition) => (condition && singlesConditions.has(condition) ? "Singles" : "Slabs");

function applyFilters(products, filters) {
  return products.filter((prod) => {
    if (prod.removed) return false;
    if (filters.type && filters.type !== "All" && prod.type !== filters.type) return false;
    if (filters.condition && filters.condition !== "All" && prod.condition !== filters.condition) return false;
    if (filters.expansion && !prod.expansion.toLowerCase().includes(filters.expansion.toLowerCase())) return false;
    if (filters.language && filters.language !== "All" && prod.language !== filters.language) return false;
    if (filters.minQuantity != null && prod.inventoryQuantity != null && prod.inventoryQuantity < filters.minQuantity) return false;
    if (filters.maxQuantity != null && prod.inventoryQuantity != null && prod.inventoryQuantity > filters.maxQuantity) return false;
    return true;
  });
}

function collectDistinctValues(products, key) {
  return Array.from(new Set(products.map((p) => p[key]).filter(Boolean))).sort();
}

function formatProduct(prod) {
  const qty = prod.inventoryQuantity == null ? "?" : prod.inventoryQuantity;
  const currency = prod.currency || "USD";
  const retailDisplay = prod.price ? formatCurrency(prod.price, currency) : formatCurrency(0, currency);
  const originalDisplay =
    prod.pricechartingValue && prod.pricechartingValue !== "-"
      ? formatCurrency(prod.pricechartingValue, currency)
      : "-";
  return `${prod.title} [${prod.condition || "Unknown"} | ${prod.type || "?"}] — ${retailDisplay} (${originalDisplay}) | Qty: ${qty} | Set: ${prod.expansion || "Unknown"}`;
}

function formatDetailed(prod) {
  const currency = prod.currency || "USD";
  const retailDisplay = prod.price ? formatCurrency(prod.price, currency) : formatCurrency(0, currency);
  const originalDisplay =
    prod.pricechartingValue && prod.pricechartingValue !== "-"
      ? formatCurrency(prod.pricechartingValue, currency)
      : "-";
  return `
Title: ${prod.title}
Condition: ${prod.condition || "Unknown"}
Type: ${prod.type || "Unknown"}
Game: ${prod.game || "Unknown"}
Language: ${prod.language || "Unknown"}
Expansion: ${prod.expansion || "Unknown"}
Vendor: ${prod.vendor || "Unknown"}
Price: ${retailDisplay} (original ${originalDisplay})
Quantity: ${prod.inventoryQuantity == null ? "?" : prod.inventoryQuantity}
Barcode: ${prod.barcode || "-"}
Source URL: ${prod.sourceUrl || "-"}
Handle: ${prod.handle}
`.trim();
}

async function editProductMenu(prod) {
  while (true) {
    console.log("\n" + formatDetailed(prod));
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Product actions",
        choices: [
          { name: "Edit retail price", value: "price" },
          { name: "Set inventory quantity", value: "quantity" },
          { name: "Change condition", value: "condition" },
          { name: "Remove product from Shopify", value: "remove" },
          { name: "Return", value: "return" },
        ],
      },
    ]);

    if (action === "price") {
      const { newPrice } = await inquirer.prompt([
        {
          name: "newPrice",
          message: `Enter new price (current ${prod.price || "0"}):`,
          validate: (input) => (!isNaN(parseFloat(input)) && parseFloat(input) >= 0) || "Enter a valid number",
        },
      ]);
      try {
        const rounded = Number(newPrice).toFixed(2);
        await updateVariantPrice(prod.variantId, String(rounded));
        prod.price = rounded;
        console.log("Price updated.");
        const qtyForLabels = prod.inventoryQuantity == null ? 1 : Math.max(1, Number(prod.inventoryQuantity));
        logLabelSession(prod, qtyForLabels, "repricing");
      } catch (err) {
        console.error("Failed to update price:", err.message || err);
      }
    } else if (action === "quantity") {
      const currentQty = prod.inventoryQuantity ?? 0;
      const { newQty } = await inquirer.prompt([
        {
          name: "newQty",
          message: `Enter new quantity (current ${currentQty}):`,
          validate: (input) => Number.isInteger(Number(input)) || "Enter a whole number",
        },
      ]);
      try {
        await setInventoryQuantity(prod.inventoryItemId, currentQty, Number(newQty));
        prod.inventoryQuantity = Number(newQty);
        console.log("Quantity updated.");
      } catch (err) {
        console.error("Failed to adjust quantity:", err.message || err);
      }
    } else if (action === "condition") {
      const { newCondition } = await inquirer.prompt([
        {
          type: "list",
          name: "newCondition",
          message: "Select new condition:",
          choices: CONDITION_CHOICES,
          default: prod.condition || "Ungraded",
        },
      ]);
      const newType = deriveType(newCondition);
      const prevType = prod.type || deriveType(prod.condition);
      try {
        await setProductCondition(prod.id, {
          sourceUrl: prod.sourceUrl,
          condition: newCondition,
          type: newType,
          game: prod.game,
          expansion: prod.expansion,
          language: prod.language,
        });
        prod.condition = newCondition;
        prod.type = newType;
        console.log("Condition updated.");
        if (prevType !== newType) {
          console.log("Note: Collection assignment may need to be updated in Shopify to reflect the new type.");
        }
        const qtyForLabels = prod.inventoryQuantity == null ? 1 : Math.max(1, Number(prod.inventoryQuantity));
        logLabelSession(prod, qtyForLabels, "repricing");
      } catch (err) {
        console.error("Failed to update condition:", err.message || err);
      }
    } else if (action === "remove") {
      const { confirmRemove } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmRemove",
          message: `Delete ${prod.title}? This cannot be undone.`,
          default: false,
        },
      ]);
      if (!confirmRemove) continue;
      if (prod.id) {
        try {
          await deleteProduct(prod.id);
          prod.removed = true;
          console.log("Product deleted from Shopify.");
          break;
        } catch (err) {
          console.error("Failed to delete product:", err.message || err);
        }
      }
    } else if (action === "return") {
      break;
    }
  }
}

async function promptFilters(products, current) {
  const typeChoices = ["All", ...collectDistinctValues(products, "type")];
  const conditionChoices = ["All", ...collectDistinctValues(products, "condition")];
  const languageChoices = ["All", ...collectDistinctValues(products, "language")];

  const baseAnswers = await inquirer.prompt([
    {
      type: "list",
      name: "type",
      message: "Filter by type:",
      choices: typeChoices.length ? typeChoices : ["All"],
      default: current.type || "All",
    },
    {
      type: "list",
      name: "condition",
      message: "Filter by condition:",
      choices: conditionChoices.length ? conditionChoices : ["All"],
      default: current.condition || "All",
    },
    {
      type: "list",
      name: "language",
      message: "Filter by language:",
      choices: languageChoices.length ? languageChoices : ["All"],
      default: current.language || "All",
    },
  ]);

  const { expansion } = await inquirer.prompt([
    { name: "expansion", message: "Filter by expansion substring (leave blank for all):", default: current.expansion || "" },
  ]);
  const expansionFilter = expansion.trim();

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
    expansion: expansionFilter,
    minQuantity: quantityAnswers.minQuantity === "" ? null : Number(quantityAnswers.minQuantity),
    maxQuantity: quantityAnswers.maxQuantity === "" ? null : Number(quantityAnswers.maxQuantity),
  };
}

async function searchProductsByTerm(products) {
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
  console.log(`Found ${matches.length} matching products.`);
  matches.slice(0, 20).forEach((prod, idx) => {
    console.log(`${idx + 1}. ${formatProduct(prod)}`);
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
  if (matches[idx]) {
    await editProductMenu(matches[idx]);
    return !!matches[idx].removed;
  }
  return false;
}

async function browseResults(products) {
  if (!products.length) {
    console.log("No products match the current filters.");
    return "refine";
  }

  const actionChoices = [
    { name: "Next page", value: "next" },
    { name: "Previous page", value: "prev" },
    { name: "Change filters", value: "refine" },
    { name: "Search products by term", value: "search" },
    { name: "Exit products view", value: "exit" },
  ];

  let page = 0;
  while (true) {
    const start = page * PAGE_SIZE;
    const slice = products.slice(start, start + PAGE_SIZE);
    console.log(`\nShowing ${start + 1}-${start + slice.length} of ${products.length}`);
    slice.forEach((prod, idx) => {
      console.log(`${start + idx + 1}. ${formatProduct(prod)}`);
    });

    const productChoices = slice.map((prod) => ({
      name: formatProduct(prod),
      value: { type: "product", product: prod },
    }));

    const navChoices = actionChoices.map((choice) => {
      if (choice.value === "next" && start + slice.length >= products.length) return { ...choice, disabled: "End" };
      if (choice.value === "prev" && page === 0) return { ...choice, disabled: "Start" };
      return choice;
    });

    const defaultAction = navChoices.find((choice) => !choice.disabled)?.value;

    const { selection } = await inquirer.prompt([
      {
        type: "list",
        name: "selection",
        message: "Select a product or action:",
        choices: [
          new inquirer.Separator("── Products ──"),
          ...productChoices,
          new inquirer.Separator("── Actions ──"),
          ...navChoices,
          new inquirer.Separator(),
        ],
        pageSize: Math.min(productChoices.length + navChoices.length + 4, 50),
        default: defaultAction,
      },
    ]);

    if (selection?.type === "product") {
      await editProductMenu(selection.product);
      if (selection.product.removed) return "refine";
      continue;
    }

    const action = selection;
    if (action === "search") {
      const removed = await searchProductsByTerm(products);
      if (removed) return "refine";
    } else if (action === "next" && start + slice.length < products.length) {
      page += 1;
    } else if (action === "prev" && page > 0) {
      page -= 1;
    } else if (action === "refine") {
      return "refine";
    } else if (action === "exit") {
      return "exit";
    }
  }
}

export default async function viewProducts() {
  console.log("Fetching products...");
  const products = await fetchAllPricechartingProducts();
  console.log(`Loaded ${products.length} products with PriceCharting source URLs.`);

  let filters = {
    type: "All",
    condition: "All",
    language: "All",
    expansion: "",
    minQuantity: null,
    maxQuantity: null,
  };

  while (true) {
    filters = await promptFilters(products, filters);
    const filtered = applyFilters(products, filters);
    console.log(`Matched ${filtered.length} products.`);
    const result = await browseResults(filtered);
    if (result === "exit") break;
    if (result === "refine") continue;
  }
}
