// src/shopify/draft.js
import axios from "axios";
import { graphqlPost, buildShopifyBase, getShopifyToken } from "./graphql.js";
import { adjustInventory } from "./inventory.js";
import { setProductMetafields, findProductBySourceUrlAndCondition } from "./metafields.js";
import { generateEAN13 } from "../utils/barcode.js";

/**
 * Create or update a product tied to a specific sourceUrl + condition.
 *
 * params: { title, price, quantity, sourceUrl, condition }
 * config: app config object
 *
 * Returns an object:
 * { productId, inventoryItemId, isNewProduct: bool, updated: bool, barcode: string|null }
 */
export default async function createDraftAndPublishToPos({ title, price, quantity, sourceUrl, condition }, config) {
  const base = buildShopifyBase();
  const token = getShopifyToken();
  if (!base || !token) throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN.");

  let productId = null;
  let inventoryItemId = null;
  let barcode = null;
  let isNewProduct = false;
  let updated = false;

  // 1) Try to find existing product by BOTH metafields (source_url + condition)
  try {
    const existingEdge = await findProductBySourceUrlAndCondition(sourceUrl, condition);
    if (existingEdge) {
      productId = existingEdge.node.id;
      const variantNode = existingEdge.node.variants?.edges?.[0]?.node;
      const invGid = variantNode?.inventoryItem?.id || null; // e.g. gid://shopify/InventoryItem/12345
      // extract numeric id if present
      const invMatch = typeof invGid === "string" ? invGid.match(/\/InventoryItem\/(\d+)$/) : null;
      inventoryItemId = invMatch?.[1] || null;
      barcode = variantNode?.barcode || null;
      updated = true;
      console.log("Existing product found by source_url & condition:", existingEdge.node.title, productId, "Barcode:", barcode);
    }
  } catch (err) {
    console.warn("Failed to query existing product:", err.message || err);
  }

  // 2) If not found, create new product (REST endpoint)
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
            inventory_quantity: 0,
            weight: 2,
            weight_unit: "g",
            barcode: generateEAN13(),
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
      const variant = product?.variants?.[0];
      inventoryItemId = variant?.inventory_item_id || null;
      barcode = variant?.barcode || null;
      isNewProduct = true;
      console.log(`Created new draft product ${title} (id: ${productId}) Barcode: ${barcode}`);
    } catch (err) {
      console.error("Product creation failed:", err.response?.status, err.response?.data || err.message);
      throw err;
    }
  }

  // 3) Adjust inventory
  if (inventoryItemId && quantity > 0) {
    try {
      await adjustInventory(inventoryItemId, quantity);
    } catch (err) { /* logs inside adjustInventory */ }
  }

  // 4) Attach / update both metafields (source_url and condition)
  try {
    await setProductMetafields(productId, sourceUrl, condition);
  } catch (err) { /* logs inside setProductMetafields */ }

  return { productId, inventoryItemId, isNewProduct, updated, barcode };
}
