#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ensure working directory is project root when running via node src/index.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from data/.env (if exists)
dotenv.config({ path: path.join(process.cwd(), "data", ".env") });

// Start CLI
import mainMenu from "./cli/mainMenu.js";

mainMenu().catch((err) => {
  console.error("Fatal error:", err && err.message ? err.message : err);
  process.exit(1);
});
