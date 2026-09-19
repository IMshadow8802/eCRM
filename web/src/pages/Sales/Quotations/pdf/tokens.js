// Colours and the page frame every template and shared part draws against.
// These live apart from parts.jsx because a file that exports both components
// and constants breaks fast refresh — and because a template that only wants a
// colour should not pull the whole parts module to get it.
export const INK = "#0f172a";
export const MUTED = "#64748b";
export const RULE = "#e2e8f0";
export const SOFT = "#f8fafc";

export const pageStyle = {
  fontFamily: "Inter",
  fontSize: 9.5,
  color: INK,
  paddingTop: 36,
  paddingBottom: 46,
  paddingHorizontal: 36,
};
