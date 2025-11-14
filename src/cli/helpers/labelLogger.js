import path from "path";
import { appendCsvRows, createSessionCSVWithId } from "../../utils/csv.js";
import { getAndIncrementSessionId } from "../../utils/config.js";

export function logLabelSession(product, quantity, sessionType = "repricing") {
  const sessionId = getAndIncrementSessionId();
  const csvPath = createSessionCSVWithId(sessionId, sessionType);
  const qty = quantity == null ? 1 : Math.max(1, Number(quantity));
  const priceValue =
    product.price != null && product.price !== ""
      ? Number(product.price).toFixed(2)
      : "0.00";

  appendCsvRows(
    csvPath,
    product.barcode || "",
    product.title || "Unknown Product",
    product.game || "Unknown Game",
    product.expansion || "Unknown Expansion",
    product.language || "EN",
    product.type || "Singles",
    product.condition || "Ungraded",
    priceValue,
    qty
  );
  console.log(`Label session created: ${path.basename(csvPath)} (${qty} label${qty === 1 ? "" : "s"})`);
}
