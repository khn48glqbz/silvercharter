import inquirer from "inquirer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

export default async function shopifySettings() {
  const envPath = path.join(process.cwd(), "data", ".env");
  const current = dotenv.config({ path: envPath }).parsed || {};

  while (true) {
    const { shopifyChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "shopifyChoice",
        message: "Shopify Settings",
        prefix: "⛏",
        choices: [
          "View Environment Variables",
          "Change Store Domain",
          "Change Admin Token",
          "Return",
        ],
      },
    ]);

    if (shopifyChoice === "View Environment Variables") {
      console.log(current);
    } else if (shopifyChoice === "Change Store Domain") {
      const { url } = await inquirer.prompt([{ name: "url", message: "Enter new store domain:" }]);
      current.SHOPIFY_STORE_URL = url;
    } else if (shopifyChoice === "Change Admin Token") {
      const { token } = await inquirer.prompt([{ name: "token", message: "Enter new Admin Token:" }]);
      current.SHOPIFY_ADMIN_TOKEN = token;
    } else if (shopifyChoice === "Return") break;

    fs.writeFileSync(envPath, Object.entries(current).map(([k, v]) => `${k}=${v}`).join("\n"));
  }
}
