import axios from "axios";
import { randomBytes } from "crypto";
import { graphqlPost } from "./graphql.js";

const iconCache = new Map();

const FILES_QUERY = `
  query ($query: String!) {
    files(first: 1, query: $query) {
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
      files { id filename url }
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

function guessMime(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

async function findFileByFilename(filename) {
  if (iconCache.has(filename)) return iconCache.get(filename);
  const query = `filename:'${filename.replace(/'/g, "\\'")}'`;
  const res = await graphqlPost({ query: FILES_QUERY, variables: { query } });
  const node = res?.data?.files?.edges?.[0]?.node;
  if (!node) {
    iconCache.set(filename, null);
    return null;
  }
  const info = { id: node.id, filename: node.filename || filename, url: node.url || node.image?.url || "" };
  iconCache.set(filename, info);
  return info;
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

async function uploadFileFromUrl(filename, url) {
  const buffer = await downloadIconBuffer(url);
  const mimeType = guessMime(filename);
  const resourceUrl = await stagedUpload(filename, buffer, mimeType);
  const filesInput = [{ originalSource: resourceUrl, contentType: "IMAGE", filename }];
  const res = await graphqlPost({ query: FILE_CREATE_MUTATION, variables: { files: filesInput } });
  const errors = res?.data?.fileCreate?.userErrors;
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const created = res?.data?.fileCreate?.files?.[0];
  if (!created) throw new Error("fileCreate returned no file.");
  const info = { id: created.id, filename: created.filename || filename, url: created.url || url };
  iconCache.set(filename, info);
  return info;
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
