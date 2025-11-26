import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import "@shopify/shopify-api/adapters/node";
import { shopifyApi } from "@shopify/shopify-api";

const ENV_PATH = path.join(process.cwd(), "data", "config", ".env");
dotenv.config({ path: ENV_PATH });

let cachedStoreDomain = null;
let cachedAccessToken = null;
let cachedClients = null;
const LOG_DIR = path.join(process.cwd(), "data", "logs");
const SDK_LOG = path.join(LOG_DIR, "shopify-sdk.log");

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore logging failures
  }
}

function logToFile(message) {
  try {
    ensureLogDir();
    fs.appendFileSync(SDK_LOG, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // ignore logging failures
  }
}

function getStoreDomain() {
  if (cachedStoreDomain) return cachedStoreDomain;
  const raw = (process.env.SHOPIFY_STORE_URL || "").trim();
  if (!raw) throw new Error("Missing SHOPIFY_STORE_URL environment variable.");
  cachedStoreDomain = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return cachedStoreDomain;
}

function getAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;
  cachedAccessToken = (process.env.SHOPIFY_ADMIN_TOKEN || "").trim();
  if (!cachedAccessToken) throw new Error("Missing SHOPIFY_ADMIN_TOKEN environment variable.");
  return cachedAccessToken;
}

function buildClients() {
  if (cachedClients) return cachedClients;
  const shopDomain = getStoreDomain();
  const accessToken = getAccessToken();

  const shopify = shopifyApi({
    adminApiAccessToken: accessToken,
    adminApiVersion: "2024-07",
    isCustomStoreApp: true,
    apiKey: process.env.SHOPIFY_API_KEY || "custom-app",
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "custom-app",
    hostName: shopDomain,
    logger: {
      log: (severity, message) => {
        logToFile(`[${severity}] ${message}`);
        if (severity === "Error") {
          console.error(message);
        }
      },
      level: "Error",
    },
  });

  const session = shopify.session.customAppSession(shopDomain);
  session.accessToken = accessToken;
  session.isOnline = false;

  const graphqlClient = new shopify.clients.Graphql({ session });
  const restClient = new shopify.clients.Rest({ session });
  cachedClients = { graphqlClient, restClient };
  return cachedClients;
}

export function getGraphqlClient() {
  return buildClients().graphqlClient;
}

export function getRestClient() {
  return buildClients().restClient;
}

export function getShopBaseUrl() {
  return `https://${getStoreDomain()}`;
}

export function getShopToken() {
  return getAccessToken();
}
