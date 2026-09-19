// GST geography. The first two digits of a GSTIN are the state that issued it,
// which is the only reliable source of the SELLER's state — far better than a
// free-text "State" field someone typed as "Gujrat".

/** The 28 states and 8 union territories, by GST state code. */
export const GST_STATES = [
  { code: "01", name: "Jammu and Kashmir" }, { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" }, { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" }, { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" }, { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" }, { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" }, { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" }, { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

// Codes still printed on old registrations. Resolvable, so a seller holding one
// gets a state; not offered in the place-of-supply dropdown.
const LEGACY = [
  { code: "25", name: "Daman and Diu" },
  { code: "28", name: "Andhra Pradesh" },
];

const BY_CODE = new Map([...GST_STATES, ...LEGACY].map((s) => [s.code, s]));

export const stateByCode = (code) => BY_CODE.get(String(code ?? "").padStart(2, "0")) ?? null;

/** Combobox options for the place-of-supply picker. */
export const STATE_OPTIONS = GST_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));

// 2 digits state + 10 char PAN + entity digit + 'Z' + checksum.
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const cleanGstin = (v) => String(v ?? "").toUpperCase().replace(/\s+/g, "");
export const isValidGstin = (v) => GSTIN.test(cleanGstin(v));

/** The issuing state's code, or null when the GSTIN is missing or malformed. */
export const stateFromGstin = (v) => {
  const g = cleanGstin(v);
  return GSTIN.test(g) && BY_CODE.has(g.slice(0, 2)) ? g.slice(0, 2) : null;
};

/**
 * A lead's free-text State → a code, for pre-filling place of supply. Exact
 * name only, case-insensitive. No fuzzy matching on purpose: a wrong guess
 * silently flips CGST/SGST to IGST, where no guess just leaves the field for
 * the user to pick.
 */
export const matchStateName = (text) => {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  return GST_STATES.find((s) => s.name.toLowerCase() === t)?.code ?? null;
};
