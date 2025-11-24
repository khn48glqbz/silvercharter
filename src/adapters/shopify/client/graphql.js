import { getGraphqlClient, getShopBaseUrl, getShopToken } from "./client.js";

export function buildShopifyBase() {
  return getShopBaseUrl();
}

export function getShopifyToken() {
  return getShopToken();
}

export async function graphqlPost(body) {
  const client = getGraphqlClient();
  const res = await client.query({ data: body });
  const payload = res?.body || {};
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((err) => err.message).join("; "));
  }
  return payload;
}
