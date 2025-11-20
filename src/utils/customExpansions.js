import fs from "fs";
import path from "path";
import { graphqlPost } from "../shopify/graphql.js";

const DATA_PATH = path.join(process.cwd(), "data", "custom-expansions.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const CUSTOM_EXPANSIONS_QUERY = `
  query ($cursor: String) {
    products(first: 50, after: $cursor, query: "metafields.pricecharting.source_url:\\"null\\"") {
      edges {
        cursor
        node {
          metafields(first: 10, namespace: "pricecharting", keys: ["game", "expansion", "source_url"]) {
            edges {
              node { key value }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function ensureDataDir() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readCacheFile() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return { lastUpdated: null, expansions: {} };
    }
    const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (!data.expansions || typeof data.expansions !== "object") {
      data.expansions = {};
    }
    return data;
  } catch (err) {
    console.warn("Failed to read custom expansions cache:", err.message || err);
    return { lastUpdated: null, expansions: {} };
  }
}

function writeCacheFile(payload) {
  ensureDataDir();
  fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2));
}

function mapMetafields(edges = []) {
  const out = {};
  for (const edge of edges || []) {
    out[edge.node.key] = edge.node.value;
  }
  return out;
}

export async function refreshCustomExpansionsCache() {
  const expansionsByGame = {};
  let cursor = null;

  while (true) {
    const res = await graphqlPost({ query: CUSTOM_EXPANSIONS_QUERY, variables: { cursor } });
    const edges = res?.data?.products?.edges || [];
    for (const edge of edges) {
      const metafields = mapMetafields(edge.node?.metafields?.edges);
      const sourceUrl = (metafields.source_url || "").trim().toLowerCase();
      if (sourceUrl && sourceUrl !== "null") continue;
      const expansion = (metafields.expansion || "").trim();
      if (!expansion) continue;
      const game = (metafields.game || "Unknown Game").trim() || "Unknown Game";
      if (!expansionsByGame[game]) expansionsByGame[game] = new Set();
      expansionsByGame[game].add(expansion);
      cursor = edge.cursor;
    }
    const pageInfo = res?.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  const serialized = {};
  Object.entries(expansionsByGame).forEach(([game, set]) => {
    serialized[game] = Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  const payload = {
    lastUpdated: new Date().toISOString(),
    expansions: serialized,
  };
  writeCacheFile(payload);
  console.log(`Custom expansion cache refreshed (${Object.keys(serialized).length} games).`);
  return payload;
}

export async function getCustomExpansions(options = {}) {
  const { forceRefresh = false } = options;
  let cache = readCacheFile();
  const lastUpdatedMs = cache.lastUpdated ? Date.parse(cache.lastUpdated) : 0;
  const stale = !lastUpdatedMs || Date.now() - lastUpdatedMs > CACHE_TTL_MS;

  if (forceRefresh || stale) {
    try {
      cache = await refreshCustomExpansionsCache();
    } catch (err) {
      console.warn("Failed to refresh custom expansions cache:", err.message || err);
    }
  }

  return cache;
}
