import { findProductBySourceUrlAndCondition, setProductMetafields } from "./metafield-service.js";
import { generateEAN13 } from "../../../shared/util/barcode.js";
import {
  adjustInventoryQuantity,
  activateInventoryLevel,
  ensureVariantInventoryManagement,
} from "./inventory-service.js";
import { createProductDraft, updateProductCore, updateVariantFields } from "./product-service.js";
import { publishProduct } from "./publish-service.js";

export default async function saveProduct(card) {
  const normalized = normalizeCard(card);
  const existing = await findProductBySourceUrlAndCondition(
    normalized.sourceUrl,
    normalized.condition,
    { signed: normalized.signed }
  );

  if (existing) {
    return updateExistingProduct(existing, normalized);
  }

  return createProduct(normalized);
}

function normalizeCard(card) {
  const title = formatTitle(card.title, card.signed);
  const barcode = ensureBarcode(card.barcode);
  const vendor = resolveVendor(card.vendor, card.game);
  const handle = String(barcode).trim();
  const productType = "Trading Card";
  const attributes =
    Array.isArray(card.attributes) && card.attributes.length
      ? card.attributes
      : card.signed
        ? ["Signature"]
        : [];

  return {
    ...card,
    title,
    barcode,
    vendor,
    handle,
    productType,
    attributes,
  };
}

function sanitizeTitle(title = "") {
  return title.replace(/\[Signature\]/gi, "").replace(/\(Signature\)/gi, "").trim();
}

function formatTitle(title, signed) {
  const base = sanitizeTitle(title);
  if (!signed) return base;
  return `${base} [Signature]`.trim();
}

function ensureBarcode(barcode) {
  return barcode || generateEAN13();
}

function resolveVendor(vendor, game) {
  return vendor || game || "Unknown Vendor";
}

async function updateExistingProduct(existing, card) {
  await updateProductCore(existing.id, {
    vendor: card.vendor,
    productType: card.productType,
    handle: card.handle,
    title: card.title,
    status: "ACTIVE",
  });

  const variant = await syncVariant(existing, card);
  await syncExistingInventory(variant, existing, card.quantity);
  await syncMetafields(existing.id, card);
  await publishSafely(existing.id, "existing product");

  return { ...existing, barcode: card.barcode };
}

async function createProduct(card) {
  const productInput = {
    title: card.title,
    vendor: card.vendor,
    productType: card.productType,
    handle: card.handle,
    status: "ACTIVE",
  };

  const created = await createProductDraft(productInput);
  const variantNode = created?.variants?.edges?.[0]?.node || null;
  const variant = await syncNewVariant(created.id, variantNode, card);
  await syncMetafields(created.id, card);
  await publishSafely(created.id, "new product");

  return {
    id: created.id,
    title: created.title,
    barcode: card.barcode,
    variantId: variant?.id || null,
    inventoryItemId: variant?.inventoryItem?.id || null,
    price: card.price,
  };
}

async function syncVariant(existingProduct, card) {
  if (!existingProduct.variantId) return null;
  const variant = await updateVariantFields(existingProduct.id, existingProduct.variantId, {
    price: card.price,
    barcode: card.barcode,
  });
  await ensureVariantInventoryManagement(existingProduct.variantId);
  return variant;
}

async function syncNewVariant(productId, variantNode, card) {
  if (!variantNode) return null;
  const variant = await updateVariantFields(productId, variantNode.id, {
    price: card.price,
    barcode: card.barcode,
  });
  await ensureVariantInventoryManagement(variantNode.id);
  await seedInventory(variant?.inventoryItem?.id || variantNode.inventoryItem?.id, card.quantity);
  return variant || variantNode;
}

async function syncExistingInventory(variant, existingProduct, quantity) {
  const inventoryItemId =
    variant?.inventoryItem?.id || variant?.inventoryItemId || existingProduct.inventoryItemId;
  if (!inventoryItemId || !Number.isFinite(quantity) || quantity === 0) {
    if (!inventoryItemId) console.warn(`No inventory item found for ${existingProduct.title}. Inventory not adjusted.`);
    return;
  }
  try {
    await adjustInventoryQuantity(inventoryItemId, quantity);
  } catch (err) {
    console.warn("Inventory adjustment failed:", err.message || err);
  }
}

async function seedInventory(inventoryItemId, quantity) {
  if (!inventoryItemId || !Number.isFinite(quantity) || quantity <= 0) return;
  try {
    await activateInventoryLevel(inventoryItemId, quantity);
  } catch (err) {
    console.warn("Failed to activate inventory level:", err.message || err);
    try {
      await adjustInventoryQuantity(inventoryItemId, quantity);
    } catch (adjustErr) {
      console.warn("Inventory adjustment fallback failed:", adjustErr.message || adjustErr);
    }
  }
}

async function syncMetafields(productId, card) {
  await setProductMetafields(productId, {
    sourceUrl: card.sourceUrl,
    condition: card.condition,
    game: card.game,
    expansion: card.expansion,
    language: card.language,
    type: card.collection,
    expansionIconId: card.expansionIconId,
    value: card.value,
    attributes: card.attributes,
    formula: card.formula,
  });
}

async function publishSafely(productId, label) {
  try {
    await publishProduct(productId);
  } catch (err) {
    console.warn(`Failed to publish ${label}:`, err.message || err);
  }
}
