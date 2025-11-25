#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { initCurrencyCache } from "./src/shared/util/currency.js";

// ensure working directory is project root when running via node src/index.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from data/config/.env (if exists)
dotenv.config({ path: path.join(process.cwd(), "data", "config", ".env") });

// Initialize currency cache (best-effort)
await initCurrencyCache();

// Start CLI
import runCli from "./src/cli/app.js";

runCli().catch((err) => {
  console.error("Fatal error:", err && err.message ? err.message : err);
  process.exit(1);
});
