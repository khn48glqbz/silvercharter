import axios from "axios";
import { buildShopifyBase, getShopifyToken } from "./graphql.js";

export async function getPosPublicationIdAuto() {
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

export async function adjustInventory(inventoryItemId, quantity) {
  const base = buildShopifyBase();
  const token = getShopifyToken();
  if (!base || !token) throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN.");

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
    return adjRes.data;
  } catch (err) {
    console.error("Inventory adjust failed:", err.response?.status, err.response?.data || err.message);
    throw err;
  }
}
