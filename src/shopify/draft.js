// src/shopify/draft.js
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Shopify from "shopify-api-node";
import { findProductBySourceUrlAndCondition, setProductMetafields, getShopifyLocationId } from "./metafields.js";
import { generateEAN13 } from "../utils/barcode.js";
import { adjustInventory } from "./inventory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../data/.env") });

const rawStoreUrl = (process.env.SHOPIFY_STORE_URL || "").trim();
const rawAdminToken = (process.env.SHOPIFY_ADMIN_TOKEN || "").trim();

if (!rawStoreUrl || !rawAdminToken) {
  throw new Error(
    "Missing Shopify credentials. Set SHOPIFY_STORE_URL and SHOPIFY_ADMIN_TOKEN in data/.env via Settings → Shopify."
  );
}

const shopify = new Shopify({
  shopName: rawStoreUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
  accessToken: rawAdminToken,
  apiVersion: "2024-04",
});

/**
 * Create or update a Shopify product draft and sync inventory.
 * Includes debug logging for inventory updates.
 */
export default async function createDraftAndPublishToPos(card, config) {
  let { title, price, quantity, sourceUrl, condition, barcode, vendor, game, expansion, language, collection } = card;

  // If no barcode is provided, generate one
  if (!barcode) {
    barcode = generateEAN13(title, condition);
  }
  const handle = String(barcode).trim();
  const resolvedVendor = vendor || game || "Unknown Vendor";
  const productTypeValue = "Trading Card";

  try {
    const existing = await findProductBySourceUrlAndCondition(sourceUrl, condition);
    const locationId = await getShopifyLocationId();
    if (!locationId) {
      console.warn("Could not get Shopify locationId; inventory updates will be skipped.");
    }

    if (existing) {
      console.log(`Updating existing product: ${title} (${condition})`);

      // Debug: log all IDs and quantity
      console.log("DEBUG: Inventory update payload", {
        inventoryItemId: existing.inventoryItemId,
        locationId,
        quantity,
      });

      if (existing.inventoryItemId && locationId) {
        try {
          const numericInventoryItemId = existing.inventoryItemId.replace(/\D/g, "");
          const invRes = await adjustInventory(numericInventoryItemId, quantity);
          console.log("Inventory adjusted successfully:", invRes);
        } catch (err) {
          console.error("Inventory adjustment failed:", err.response?.data || err.message);
        }
      } else {
        console.warn(`No inventoryItemId found for ${title}. Inventory not updated.`);
      }

      // Update product fields (and variant if available)
      try {
        const updatePayload = {
          vendor: resolvedVendor,
          product_type: productTypeValue,
          handle,
        };
        if (existing.variantId) {
          updatePayload.variants = [{ id: existing.variantId, price, barcode }];
        }
        const updateRes = await shopify.product.update(existing.id, updatePayload);
        console.log("Product update response:", updateRes);
      } catch (err) {
        console.error("Product update failed:", err.response?.body || err.message, err.response?.status);
      }

      // Ensure metafields
      await setProductMetafields(existing.id, { sourceUrl, condition, game, expansion, language, type: collection });

      return { ...existing, barcode };
    }

    // Create new draft product
    console.log(`Uploading new product: ${title} (${condition}) — GBP ${price.toFixed(2)}`);
    const newProduct = await shopify.product.create({
      title,
      status: "draft",
      vendor: resolvedVendor,
      product_type: productTypeValue,
      handle,
      variants: [
        {
          price,
          inventory_management: "shopify",
          inventory_quantity: quantity,
          barcode,
        },
      ],
      metafields: [
        { namespace: "pricecharting", key: "source_url", value: sourceUrl, type: "single_line_text_field" },
        { namespace: "pricecharting", key: "condition", value: condition, type: "single_line_text_field" },
      ],
    });

    await setProductMetafields(newProduct.id, { sourceUrl, condition, game, expansion, language, type: collection });

    console.log(`Draft created: ${newProduct.title}`);
    return newProduct;

  } catch (err) {
    console.error("Error importing card:", err.response?.body || err.message, err.response?.status);
    throw err;
  }
}
