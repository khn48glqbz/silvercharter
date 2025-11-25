import { getRestClient } from "../client/client.js";
import { getShopifyLocationId, getCachedLocationNumeric } from "./metafield-service.js";

const trackedCache = new Set();

function normalizeId(gid) {
  if (!gid) return null;
  const match = String(gid).match(/(\d+)$/);
  return match ? match[1] : null;
}

async function ensureInventoryTracking(inventoryItemId) {
  if (!inventoryItemId || trackedCache.has(inventoryItemId)) return;
  const rest = getRestClient();
  const numericId = normalizeId(inventoryItemId);
  if (!numericId) throw new Error("Invalid inventory item id.");
  try {
    await rest.put({
      path: `inventory_items/${numericId}`,
      data: { inventory_item: { id: Number(numericId), tracked: true } },
      type: "application/json",
    });
    trackedCache.add(inventoryItemId);
  } catch (err) {
    const payload = err?.response?.body || err.message || err;
    throw new Error(`Failed to enable inventory tracking: ${JSON.stringify(payload)}`);
  }
}

async function ensureInventoryConnection(inventoryItemId) {
  const rest = getRestClient();
  const cachedNumeric = getCachedLocationNumeric();
  const locationId = cachedNumeric || (await getShopifyLocationId());
  const numericItemId = normalizeId(inventoryItemId);
  const numericLocationId = normalizeId(locationId);
  if (!numericItemId || !numericLocationId) {
    throw new Error("Unable to resolve inventory identifiers for connection.");
  }
  try {
    await rest.post({
      path: "inventory_levels/connect",
      data: {
        inventory_item_id: Number(numericItemId),
        location_id: Number(numericLocationId),
      },
      type: "application/json",
    });
  } catch (err) {
    const response = err?.response?.body;
    const alreadyConnected =
      err?.response?.code === 422 &&
      typeof response === "object" &&
      JSON.stringify(response).toLowerCase().includes("already connected");
    if (!alreadyConnected) {
      const payload = response || err.message || err;
      throw new Error(`Inventory connect failed: ${JSON.stringify(payload)}`);
    }
  }
  return { itemId: Number(numericItemId), locationId: Number(numericLocationId) };
}

export async function activateInventoryLevel(inventoryItemId, available) {
  if (!inventoryItemId) throw new Error("Missing inventory item ID for activation.");
  await ensureInventoryTracking(inventoryItemId);
  const { itemId, locationId } = await ensureInventoryConnection(inventoryItemId);
  const rest = getRestClient();
  try {
    await rest.post({
      path: "inventory_levels/set",
      data: {
        inventory_item_id: itemId,
        location_id: locationId,
        available: Math.max(0, Math.trunc(available ?? 0)),
      },
      type: "application/json",
    });
  } catch (err) {
    const payload = err?.response?.body || err.message || err;
    throw new Error(`Inventory set failed: ${JSON.stringify(payload)}`);
  }
}

export async function adjustInventoryQuantity(inventoryItemId, delta) {
  if (!inventoryItemId) throw new Error("Missing inventory item ID for adjustment.");
  if (!Number.isFinite(delta) || delta === 0) return null;
  await ensureInventoryTracking(inventoryItemId);
  const { itemId, locationId } = await ensureInventoryConnection(inventoryItemId);
  const rest = getRestClient();
  try {
    await rest.post({
      path: "inventory_levels/adjust",
      data: {
        inventory_item_id: itemId,
        location_id: locationId,
        available_adjustment: Math.trunc(delta),
      },
      type: "application/json",
    });
  } catch (err) {
    const payload = err?.response?.body || err.message || err;
    throw new Error(`Inventory adjust failed: ${JSON.stringify(payload)}`);
  }
}

export async function ensureVariantInventoryManagement(variantId) {
  if (!variantId) return;
  const rest = getRestClient();
  const numericId = normalizeId(variantId);
  if (!numericId) throw new Error("Invalid variant id.");
  try {
    await rest.put({
      path: `variants/${numericId}`,
      data: {
        variant: {
          id: Number(numericId),
          inventory_management: "shopify",
          inventory_policy: "deny",
          requires_shipping: true,
        },
      },
      type: "application/json",
    });
  } catch (err) {
    const payload = err?.response?.body || err.message || err;
    throw new Error(`Failed to enable variant inventory management: ${JSON.stringify(payload)}`);
  }
}
