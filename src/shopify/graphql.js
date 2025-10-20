import axios from "axios";

export function buildShopifyBase() {
  const raw = (process.env.SHOPIFY_STORE_URL || "").trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
}

export function getShopifyToken() {
  return (process.env.SHOPIFY_ADMIN_TOKEN || "").trim();
}

export async function graphqlPost(body) {
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
