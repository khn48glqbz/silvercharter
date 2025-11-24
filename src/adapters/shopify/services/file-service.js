import axios from "axios";
import { randomBytes } from "crypto";
import { graphqlPost } from "../client/graphql.js";
import { logDebug } from "../../../shared/logging/logger.js";

const iconCache = new Map();
let fileSnapshot = null;
let fileSnapshotTimestamp = 0;
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_LIMIT = 400;
const SEARCH_BATCH_SIZE = 25;
const SNAPSHOT_BATCH_SIZE = 50;

function setCacheEntry(key, value) {
  if (!key) return;
  iconCache.set(String(key).toLowerCase(), value);
}

const FILES_QUERY = `
  query ($first: Int!, $query: String, $cursor: String) {
    files(first: $first, query: $query, after: $cursor) {
      edges {
        cursor
        node {
          id
          __typename
          ... on MediaImage {
            image { url width height }
          }
          ... on GenericFile {
            url
          }
          ... on Video {
            originalSource { url }
          }
          ... on ExternalVideo {
            originUrl
          }
          ... on Model3d {
            originalSource { url }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const FILE_CREATE_MUTATION = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        ... on MediaImage {
          image { url }
        }
        __typename
      }
      userErrors { field message }
    }
  }
`;

const STAGED_UPLOAD_MUTATION = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

function deriveFilenameFromUrl(url = "", fallback = "") {
  if (!url) return fallback;
  try {
    const clean = url.split("?")[0];
    const parts = clean.split("/");
    const last = parts.pop();
    return last || fallback;
  } catch {
    return fallback;
  }
}

function formatFileNode(node, fallbackFilename) {
  if (!node) return null;
  const primaryUrl =
    node.url ||
    node.image?.url ||
    node.originalSource?.url ||
    node.originUrl ||
    "";
  const filename = node.filename || deriveFilenameFromUrl(primaryUrl, fallbackFilename);
  return {
    id: node.id,
    filename: filename || fallbackFilename,
    url: primaryUrl,
    width: node.image?.width ?? null,
    height: node.image?.height ?? null,
  };
}

function guessMime(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function escapeSearchValue(value = "") {
  return value.replace(/"/g, '\\"');
}

function escapeSingleQuotes(value = "") {
  return value.replace(/'/g, "\\'");
}

function slugifyForSearch(value = "") {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function runFilesQuery({ query = null, cursor = null, first = SEARCH_BATCH_SIZE } = {}) {
  const variables = { query, cursor, first };
  const res = await graphqlPost({ query: FILES_QUERY, variables });
  const edges = res?.data?.files?.edges || [];
  const nodes = edges.map((edge) => edge.node);
  const pageInfo = res?.data?.files?.pageInfo || {};
  return { nodes, pageInfo };
}

async function queryFiles(fragment) {
  const { nodes } = await runFilesQuery({ query: fragment, first: SEARCH_BATCH_SIZE });
  return nodes;
}

async function getAllFilesSnapshot(force = false) {
  const now = Date.now();
  if (!force && fileSnapshot && now - fileSnapshotTimestamp < SNAPSHOT_TTL_MS) {
    return fileSnapshot;
  }
  let cursor = null;
  const collected = [];
  while (true) {
    const { nodes, pageInfo } = await runFilesQuery({
      query: null,
      cursor,
      first: SNAPSHOT_BATCH_SIZE,
    });
    collected.push(...nodes);
    if (!pageInfo?.hasNextPage || collected.length >= SNAPSHOT_LIMIT) break;
    cursor = pageInfo.endCursor;
  }
  const formatted = collected
    .filter(Boolean)
    .map((node) => formatFileNode(node, node?.filename || ""));
  fileSnapshot = formatted;
  fileSnapshotTimestamp = now;
  logDebug("file snapshot refreshed", { count: formatted.length });
  return formatted;
}

export async function findFileByFilename(filename) {
  if (!filename) return null;
  const trimmed = filename.trim();
  if (!trimmed) return null;
  const cacheKey = trimmed.toLowerCase();
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);

  const baseName = trimmed.replace(/\.[^.]+$/, "");
  const normalizedBase = baseName ? baseName.toLowerCase() : "";
  const slugVariant = slugifyForSearch(baseName || trimmed);
  const exactLower = trimmed.toLowerCase();
  const simplifiedSearch = exactLower.replace(/[^a-z0-9]/g, "");

  const queryFragments = new Set();
  const addExact = (value) => {
    if (!value) return;
    const escaped = escapeSearchValue(value);
    queryFragments.add(`filename:${escaped}`);
    queryFragments.add(`filename:"${escaped}"`);
    queryFragments.add(`filename:'${escapeSingleQuotes(value)}'`);
  };
  const addWildcard = (value) => {
    if (!value) return;
    if (/\s/.test(value)) return;
    queryFragments.add(`filename:${value}`);
  };
  const addGeneral = (value) => {
    if (!value) return;
    queryFragments.add(value);
  };
  const addContains = (value) => {
    if (!value) return;
    const escaped = escapeSearchValue(value);
    queryFragments.add(`filename:*${escaped}*`);
  };

  addExact(trimmed);
  addContains(trimmed);
  addGeneral(trimmed);
  if (baseName && baseName !== trimmed) {
    addExact(baseName);
    addWildcard(`${baseName}*`);
    addContains(baseName);
    addGeneral(baseName);
  }
  if (slugVariant && slugVariant !== normalizedBase) {
    addExact(slugVariant);
    addWildcard(`${slugVariant}*`);
    addContains(slugVariant);
    addGeneral(slugVariant);
  }

  const fragmentsList = Array.from(queryFragments);
  logDebug("findFileByFilename fragments", { filename: trimmed, fragments: fragmentsList });

  let matchedNode = null;
  for (const fragment of queryFragments) {
    try {
      logDebug("findFileByFilename query", { fragment });
      const nodes = await queryFiles(fragment);
      logDebug("findFileByFilename results", { fragment, count: nodes.length });
      if (!nodes.length) continue;
      const lowerNodes = nodes.map((n) => ({
        raw: n,
        name: (n.filename || "").toLowerCase(),
        simplified: (n.filename || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
      }));
      const exactMatch = lowerNodes.find((entry) => entry.name === exactLower);
      const startsWithExact = lowerNodes.find((entry) => entry.name.startsWith(exactLower));
      const startsWithBase =
        normalizedBase && lowerNodes.find((entry) => entry.name.startsWith(`${normalizedBase}.`));
      const simplifiedMatch =
        simplifiedSearch && lowerNodes.find((entry) => entry.simplified.includes(simplifiedSearch));
      const slugMatch =
        slugVariant && lowerNodes.find((entry) => entry.simplified.includes(slugVariant));
      matchedNode =
        exactMatch?.raw ||
        startsWithExact?.raw ||
        startsWithBase?.raw ||
        simplifiedMatch?.raw ||
        slugMatch?.raw ||
        lowerNodes[0]?.raw;
      if (matchedNode) break;
    } catch (err) {
      logDebug("findFileByFilename error", { fragment, message: err.message || String(err) });
      continue;
    }
  }

  if (!matchedNode) {
    try {
      const snapshot = await getAllFilesSnapshot();
      const fallback = snapshot.find(
        (file) => (file.filename || "").toLowerCase() === exactLower
      );
      if (fallback) {
        logDebug("findFileByFilename snapshot hit", {
          filename: trimmed,
          matched: fallback.filename,
          id: fallback.id,
        });
        setCacheEntry(cacheKey, fallback);
        if (fallback.filename) setCacheEntry(fallback.filename, fallback);
        return fallback;
      }
    } catch (err) {
      logDebug("findFileByFilename snapshot error", { message: err.message || String(err) });
    }
    logDebug("findFileByFilename miss", { filename: trimmed });
    setCacheEntry(cacheKey, null);
    return null;
  }

  const info = formatFileNode(matchedNode, trimmed);
  setCacheEntry(cacheKey, info);
  if (matchedNode.filename) {
    setCacheEntry(matchedNode.filename, info);
  }
  logDebug("findFileByFilename hit", { filename: trimmed, matched: info.filename, id: info.id });
  return info;
}

export async function searchFilesByTerm(term) {
  const trimmed = (term || "").trim();
  if (!trimmed) return [];
  const slug = slugifyForSearch(trimmed);
  const escaped = escapeSearchValue(trimmed);
  const escapedSingle = escapeSingleQuotes(trimmed);

  const queries = [];
  const pushQuery = (value) => {
    if (value && !queries.includes(value)) queries.push(value);
  };

  pushQuery(trimmed);
  pushQuery(`filename:${escaped}`);
  pushQuery(`filename:"${escaped}"`);
  pushQuery(`filename:'${escapedSingle}'`);
  if (!trimmed.includes("*")) pushQuery(`filename:${escaped}*`);
  pushQuery(`filename:*${escaped}*`);

  if (slug && slug !== trimmed) {
    pushQuery(slug);
    pushQuery(`filename:${slug}`);
    pushQuery(`filename:${slug}*`);
    pushQuery(`filename:*${slug}*`);
  }

  const results = [];
  const seen = new Set();
  logDebug("searchFilesByTerm fragments", { term: trimmed, fragments: queries });
  for (const fragment of queries) {
    let nodes = [];
    try {
      logDebug("searchFilesByTerm query", { fragment });
      nodes = await queryFiles(fragment);
      logDebug("searchFilesByTerm results", { fragment, count: nodes.length });
    } catch (err) {
      logDebug("searchFilesByTerm error", { fragment, message: err.message || String(err) });
      continue;
    }
    for (const node of nodes) {
      if (!node?.id || seen.has(node.id)) continue;
      const info = formatFileNode(node, node.filename || trimmed);
      seen.add(info.id);
      results.push(info);
      if (results.length >= 25) {
        logDebug("searchFilesByTerm combined", { term: trimmed, count: results.length });
        return results;
      }
    }
  }

  if (!results.length) {
    try {
      const snapshot = await getAllFilesSnapshot();
      const lowerTerm = trimmed.toLowerCase();
      const fallback = snapshot.filter((file) =>
        (file.filename || "").toLowerCase().includes(lowerTerm)
      );
      if (fallback.length) {
        logDebug("searchFilesByTerm snapshot hit", { term: trimmed, count: fallback.length });
        return fallback.slice(0, 25);
      }
    } catch (err) {
      logDebug("searchFilesByTerm snapshot error", { term: trimmed, message: err.message || String(err) });
    }
  }

  logDebug("searchFilesByTerm combined", { term: trimmed, count: results.length });
  return results;
}

async function downloadIconBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:110.0) Gecko/20100101 Firefox/110.0",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.pricecharting.com/",
    },
  });
  return Buffer.from(res.data);
}

function buildMultipartBody(parameters, buffer, mimeType, filename) {
  const boundary = `----PriceCharting${randomBytes(16).toString("hex")}`;
  const chunks = [];
  const crlf = "\r\n";

  for (const param of parameters || []) {
    chunks.push(
      Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${param.name}"${crlf}${crlf}${param.value}${crlf}`)
    );
  }

  chunks.push(
    Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}Content-Type: ${mimeType}${crlf}${crlf}`
    )
  );
  chunks.push(buffer);
  chunks.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

  return { body: Buffer.concat(chunks), boundary };
}

async function stagedUpload(filename, buffer, mimeType) {
  const input = [
    {
      filename,
      mimeType,
      resource: "IMAGE",
      httpMethod: "POST",
      fileSize: String(buffer.length),
    },
  ];
  const res = await graphqlPost({ query: STAGED_UPLOAD_MUTATION, variables: { input } });
  const errors = res?.data?.stagedUploadsCreate?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  const target = res?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    console.warn("stagedUploadsCreate response:", JSON.stringify(res));
    throw new Error("No staged upload target returned.");
  }

  const { body, boundary } = buildMultipartBody(target.parameters, buffer, mimeType, filename);
  await axios.post(target.url, body, {
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return target.resourceUrl;
}

async function waitForFileRecord(filename, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const info = await findFileByFilename(filename);
    if (info?.id) return info;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function uploadFileFromUrl(filename, url) {
  const buffer = await downloadIconBuffer(url);
  const mimeType = guessMime(filename);
  const resourceUrl = await stagedUpload(filename, buffer, mimeType);
  const filesInput = [{ originalSource: resourceUrl, contentType: "IMAGE", filename }];
  const res = await graphqlPost({ query: FILE_CREATE_MUTATION, variables: { files: filesInput } });
  const errors = res?.data?.fileCreate?.userErrors;
  if (errors?.length) {
    console.error("fileCreate userErrors:", JSON.stringify(errors, null, 2));
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  const created = res?.data?.fileCreate?.files?.[0];
  if (!created) {
    console.error("fileCreate raw response:", JSON.stringify(res, null, 2));
    throw new Error("fileCreate returned no file.");
  }
  const ensured = await waitForFileRecord(filename, 6);
  if (ensured) {
    setCacheEntry(filename, ensured);
    return ensured;
  }
  const fallback = { id: created.id, filename, url }
  setCacheEntry(filename, fallback);
  return fallback;
}

export async function ensureExpansionIconFile(iconMeta) {
  if (!iconMeta?.filename || !iconMeta?.url) return null;
  const filename = iconMeta.filename;
  let existing = await findFileByFilename(filename);
  if (existing) return existing;
  try {
    existing = await uploadFileFromUrl(filename, iconMeta.url);
    return existing;
  } catch (err) {
    console.warn(`Failed to upload icon ${filename}:`, err.message || err);
    return null;
  }
}
