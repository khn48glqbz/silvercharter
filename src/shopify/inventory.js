import axios from "axios";
import { buildShopifyBase, getShopifyToken } from "./graphql.js";
import { getShopifyLocationId } from "./metafields.js";

const trackedCache = new Set();

function normalizeId(gid) {
  if (!gid) return null;
  const match = String(gid).match(/(\d+)$/);
  return match ? match[1] : null;
}

function buildRestHeaders() {
  const token = getShopifyToken();
  if (!token) throw new Error("Missing SHOPIFY_ADMIN_TOKEN for inventory calls.");
  return {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function ensureInventoryConnection(inventoryItemId) {
  const base = buildShopifyBase();
  const locationGid = await getShopifyLocationId();
  const numericItemId = normalizeId(inventoryItemId);
  const numericLocationId = normalizeId(locationGid);
  if (!base || !numericItemId || !numericLocationId) {
    throw new Error("Unable to resolve inventory identifiers for connection.");
  }
  const url = `${base}/admin/api/2024-07/inventory_levels/connect.json`;
  const body = {
    inventory_item_id: Number(numericItemId),
    location_id: Number(numericLocationId),
  };
  try {
    await axios.post(url, body, { headers: buildRestHeaders(), timeout: 15000 });
  } catch (err) {
    const alreadyConnected =
      err?.response?.status === 422 &&
      JSON.stringify(err.response?.data || "").toLowerCase().includes("already connected");
    if (!alreadyConnected) {
      const payload = err?.response?.data || err.message;
      console.error("inventoryLevels connect failed payload:", JSON.stringify(payload, null, 2));
      throw new Error(`Inventory connect failed: ${JSON.stringify(payload)}`);
    }
  }
  return { itemId: Number(numericItemId), locationId: Number(numericLocationId) };
}

export async function ensureInventoryTracking(inventoryItemId) {
  if (!inventoryItemId) return;
  if (trackedCache.has(inventoryItemId)) return;
  const base = buildShopifyBase();
  if (!base) throw new Error("Missing Shopify base URL.");
  const numericItemId = normalizeId(inventoryItemId);
  if (!numericItemId) throw new Error("Invalid inventory item id");
  const url = `${base}/admin/api/2024-07/inventory_items/${numericItemId}.json`;
  const body = { inventory_item: { id: Number(numericItemId), tracked: true } };
  try {
    await axios.put(url, body, { headers: buildRestHeaders(), timeout: 15000 });
    trackedCache.add(inventoryItemId);
  } catch (err) {
    const payload = err?.response?.data || err.message;
    throw new Error(`Failed to enable inventory tracking: ${JSON.stringify(payload)}`);
  }
}

export async function ensureVariantInventoryManagement(variantId) {
  if (!variantId) return;
  const base = buildShopifyBase();
  if (!base) throw new Error("Missing Shopify base URL.");
  const numericVariantId = normalizeId(variantId);
  if (!numericVariantId) throw new Error("Invalid variant id");
  const url = `${base}/admin/api/2024-07/variants/${numericVariantId}.json`;
  const body = {
    variant: {
      id: Number(numericVariantId),
      inventory_management: "shopify",
      inventory_policy: "deny",
      requires_shipping: true,
    },
  };
  try {
    await axios.put(url, body, { headers: buildRestHeaders(), timeout: 15000 });
  } catch (err) {
    const payload = err?.response?.data || err.message;
    throw new Error(`Failed to enable variant inventory management: ${JSON.stringify(payload)}`);
  }
}

export async function adjustInventoryQuantity(inventoryItemId, delta) {
  if (!inventoryItemId) throw new Error("Missing inventory item ID for adjustment.");
  if (!Number.isFinite(delta) || delta === 0) return null;
  await ensureInventoryTracking(inventoryItemId);
  const base = buildShopifyBase();
  if (!base) throw new Error("Missing Shopify base URL.");
  const { itemId, locationId } = await ensureInventoryConnection(inventoryItemId);
  const body = {
    inventory_item_id: itemId,
    location_id: locationId,
    available_adjustment: Math.trunc(delta),
  };
  const url = `${base}/admin/api/2024-07/inventory_levels/adjust.json`;
  try {
    const res = await axios.post(url, body, { headers: buildRestHeaders(), timeout: 15000 });
    return res.data;
  } catch (err) {
    const payload = err?.response?.data || err.message;
    console.error("inventoryLevels adjust failed payload:", JSON.stringify(payload, null, 2));
    throw new Error(`Inventory adjust failed: ${JSON.stringify(payload)}`);
  }
}

export async function activateInventoryLevel(inventoryItemId, available) {
  if (!inventoryItemId) throw new Error("Missing inventory item ID for activation.");
  await ensureInventoryTracking(inventoryItemId);
  const base = buildShopifyBase();
  if (!base) throw new Error("Missing Shopify base URL.");
  const { itemId, locationId } = await ensureInventoryConnection(inventoryItemId);
  const url = `${base}/admin/api/2024-07/inventory_levels/set.json`;
  const body = {
    inventory_item_id: itemId,
    location_id: locationId,
    available: Math.max(0, Math.trunc(available ?? 0)),
  };
  try {
    const res = await axios.post(url, body, { headers: buildRestHeaders(), timeout: 15000 });
    return res.data;
  } catch (err) {
    const payload = err?.response?.data || err.message;
    console.error("inventoryLevels set failed payload:", JSON.stringify(payload, null, 2));
    throw new Error(`Inventory set failed: ${JSON.stringify(payload)}`);
  }
}
