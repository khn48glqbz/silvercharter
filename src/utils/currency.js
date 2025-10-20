import axios from "axios";

export async function convertFromUSD(amount, config) {
  const target = (config && config.currency) ? config.currency : "GBP";
  if (target === "USD") return amount;
  try {
    const url = `https://api.frankfurter.app/latest?amount=${amount}&from=USD&to=${target}`;
    const res = await axios.get(url, { timeout: 10000 });
    const converted = res.data?.rates?.[target];
    return typeof converted === "number" ? converted : amount;
  } catch (err) {
    console.warn("Currency conversion failed; using original USD amount:", err.message);
    return amount;
  }
}
