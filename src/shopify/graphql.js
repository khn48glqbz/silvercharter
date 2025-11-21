import axios from "axios";
import dotenv from "dotenv";
import path from "path";

const ENV_PATH = path.join(process.cwd(), "data", ".env");
dotenv.config({ path: ENV_PATH });

let cachedBase = null;
let cachedToken = null;

export function buildShopifyBase() {
  if (cachedBase) return cachedBase;
  const raw = (process.env.SHOPIFY_STORE_URL || "").trim();
  if (!raw) return null;
  cachedBase = /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
  return cachedBase;
}

export function getShopifyToken() {
  if (cachedToken) return cachedToken;
  cachedToken = (process.env.SHOPIFY_ADMIN_TOKEN || "").trim();
  return cachedToken;
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
  const payload = res.data;
  if (payload?.errors?.length) {
    throw new Error(payload.errors.map((err) => err.message).join("; "));
  }
  return payload;
}
