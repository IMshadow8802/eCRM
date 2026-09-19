// "Rupees Three Lakh Two Thousand Four Hundred Only" — the line every Indian
// quotation carries under its total. Indian grouping: crore, lakh, thousand.

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const below100 = (n) => (n < 20 ? ONES[n] : [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" "));
const below1000 = (n) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", below100(n % 100)].filter(Boolean).join(" ");

function words(n) {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  return [
    // Above 99 crore the crore part is itself a number: "One Hundred Twenty Crore".
    crore ? `${words(crore)} Crore` : "",
    lakh ? `${below100(lakh)} Lakh` : "",
    thousand ? `${below100(thousand)} Thousand` : "",
    below1000(rest),
  ].filter(Boolean).join(" ");
}

export function amountInWords(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return "";
  // Round to whole paise without the float error `n * 100` can introduce at
  // an exact halfway point (1.005 * 100 is 100.49999999999999 in a double,
  // which rounds down). Shifting the decimal through a string first uses the
  // exact decimal-string parser instead of double multiplication, so the
  // halfway case rounds the same way as the rest of this feature: up.
  const paise = Math.round(Number(`${n}e2`));
  // A number that stringifies in exponential notation (1e21 and up, or below
  // 1e-6) makes the shift above `1e21e2`, which parses to NaN. Unreachable from
  // a quotation total, but this is an exported helper — fail empty, not garbage.
  if (!Number.isFinite(paise)) return "";
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${words(r)}${p ? ` and Paise ${below100(p)}` : ""} Only`;
}
