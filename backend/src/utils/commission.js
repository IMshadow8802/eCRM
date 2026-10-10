// src/utils/commission.js
// Same rule the SP enforces; checked here so a typo is a 400, not a round trip.
function termsError(CommType, CommValue) {
  if (CommType == null && CommValue == null) return null;
  const v = Number(CommValue);
  if (!["pct", "fixed"].includes(CommType) || CommValue == null || !Number.isFinite(v) || v < 0 || (CommType === "pct" && v > 100)) {
    return "Commission must be a percent from 0 to 100 or an amount of 0 or more";
  }
  return null;
}

module.exports = { termsError };
