import { loadConfig } from "../app/config/settings.js";
import mainMenu from "./menus/main-menu.js";

export default async function runCli() {
  const config = loadConfig();
  await mainMenu(config);
}
