import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import dotenv from "dotenv";

export default async function settingsMenu(config) {
  // load existing env if present
  const envPath = path.join(process.cwd(), "data", ".env");
  const current = dotenv.config({ path: envPath }).parsed || {};

  const answers = await inquirer.prompt([
    {
      name: "SHOPIFY_STORE_URL",
      message: "Shopify Store URL (hostname, e.g. yourshop.myshopify.com) - do NOT include protocol:",
      default: current.SHOPIFY_STORE_URL || process.env.SHOPIFY_STORE_URL || "",
    },
    {
      name: "SHOPIFY_ADMIN_TOKEN",
      message: "Admin API Token (X-Shopify-Access-Token):",
      default: current.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN || "",
    },
    {
      name: "POS_PUBLICATION_ID",
      message: "POS Publication ID (optional; leave blank to auto-detect):",
      default: current.POS_PUBLICATION_ID || process.env.POS_PUBLICATION_ID || "",
    },
  ]);

  // ensure data dir exists
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const content = Object.entries(answers).map(([k, v]) => `${k}=${v}`).join("\n");
  fs.writeFileSync(envPath, content, "utf8");
  console.log(".env updated. Note: changes take effect after restarting the script or calling dotenv.config().");
  dotenv.config({ path: envPath });
}
