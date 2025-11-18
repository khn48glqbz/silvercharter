import axios from "axios";
import { randomBytes } from "crypto";
import { graphqlPost } from "./graphql.js";

const iconCache = new Map();

function setCacheEntry(key, value) {
  if (!key) return;
  iconCache.set(String(key).toLowerCase(), value);
}

const FILES_QUERY = `
  query ($query: String!) {
    files(first: 25, query: $query) {
      edges {
        node {
          id
          filename
          url
          ... on MediaImage {
            image { url }
          }
        }
      }
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

function formatFileNode(node, fallbackFilename) {
  if (!node) return null;
  return {
    id: node.id,
    filename: node.filename || fallbackFilename,
    url: node.url || node.image?.url || "",
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

async function queryFiles(query) {
  const res = await graphqlPost({ query: FILES_QUERY, variables: { query } });
  return res?.data?.files?.edges?.map((edge) => edge.node) || [];
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

  addExact(trimmed);
  addGeneral(trimmed);
  if (baseName && baseName !== trimmed) {
    addExact(baseName);
    addWildcard(`${baseName}*`);
    addGeneral(baseName);
  }
  if (slugVariant && slugVariant !== normalizedBase) {
    addExact(slugVariant);
    addWildcard(`${slugVariant}*`);
    addGeneral(slugVariant);
  }

  let matchedNode = null;
  for (const fragment of queryFragments) {
    try {
      const nodes = await queryFiles(fragment);
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
      continue;
    }
  }

  if (!matchedNode) {
    setCacheEntry(cacheKey, null);
    return null;
  }

  const info = formatFileNode(matchedNode, trimmed);
  setCacheEntry(cacheKey, info);
  if (matchedNode.filename) {
    setCacheEntry(matchedNode.filename, info);
  }
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

  if (slug && slug !== trimmed) {
    pushQuery(slug);
    pushQuery(`filename:${slug}`);
    pushQuery(`filename:${slug}*`);
  }

  const results = [];
  const seen = new Set();
  for (const fragment of queries) {
    let nodes = [];
    try {
      nodes = await queryFiles(fragment);
    } catch (err) {
      continue;
    }
    for (const node of nodes) {
      if (!node?.id || seen.has(node.id)) continue;
      const info = formatFileNode(node, node.filename || trimmed);
      seen.add(info.id);
      results.push(info);
      if (results.length >= 25) return results;
    }
  }

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
