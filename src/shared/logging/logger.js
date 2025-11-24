import fs from "fs";
import path from "path";

const LOG_PATH = path.join(process.cwd(), "data", "logs", "silvercharter.log");

function ensureLogFile() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, "", "utf8");
  }
}

export function logDebug(message, payload) {
  try {
    ensureLogFile();
    const timestamp = new Date().toISOString();
    const serialized =
      payload === undefined
        ? ""
        : typeof payload === "string"
          ? payload
          : JSON.stringify(payload, null, 2);
    const line = `[${timestamp}] ${message}${serialized ? ` ${serialized}` : ""}\n`;
    fs.appendFileSync(LOG_PATH, line, "utf8");
  } catch (err) {
    console.warn("Failed to write log:", err.message);
  }
}

export function getLogPath() {
  ensureLogFile();
  return LOG_PATH;
}
