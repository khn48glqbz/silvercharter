// src/utils/barcode.js

export function generateEAN13() {
  // 12 digits from timestamp (milliseconds)
  const timestamp12 = String(Date.now()).slice(-12).padStart(12, "0");
  
  // Calculate the checksum
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(timestamp12[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;

  return timestamp12 + checkDigit;
}
