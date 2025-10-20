export function applyPricingFormula(price, config) {
  let finalPrice = Number(price);
  const formula = config?.pricing?.formula || "*1.0";
  if (formula.startsWith("*")) finalPrice = finalPrice * parseFloat(formula.slice(1));
  else if (formula.startsWith("+")) finalPrice = finalPrice + parseFloat(formula.slice(1));
  if (config?.pricing?.roundTo99) {
    finalPrice = Math.ceil(finalPrice) - 0.01;
  }
  return Number(finalPrice.toFixed(2));
}
