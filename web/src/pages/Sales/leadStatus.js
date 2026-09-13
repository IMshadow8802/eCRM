// The lookup's Code is the machine meaning behind an editable label.
// open | qualified = still being worked; lost | junk | converted = closed.
export const isActiveCode = (code) => code === "open" || code === "qualified";

export const LEAD_PRESETS = [
  { value: "all", label: "All" },
  { value: "mine", label: "My leads" },
  { value: "overdue", label: "Overdue" },
  { value: "unassigned", label: "Unassigned" },
  { value: "lost", label: "Lost" },
];

export const presetParams = (preset, userId) => {
  switch (preset) {
    case "mine": return { OwnerId: userId };
    case "overdue": return { Overdue: true };
    case "unassigned": return { Unassigned: true };
    case "lost": return { StatusCode: "lost" };
    default: return {};
  }
};

export const FOLLOWUP_TYPES = [
  { value: "call", label: "Call" },
  { value: "visit", label: "Visit" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

export const DIRECTIONS = [
  { value: "out", label: "Outgoing" },
  { value: "in", label: "Incoming" },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const idParam = (v) => (v && /^\d+$/.test(v) ? Number(v) : "");
const isOn = (v) => v === "1" || v === "true";

/**
 * Leads-list state from URL search params — the report drill-down contract
 * (spec 4a §5): StatusCode / StatusId / SourceId / ProductId / OwnerId /
 * BranchId / Overdue / Unassigned / from / to. Presets win the way the tabs
 * do; "" is the filters' own empty value, so the Comboboxes stay controlled.
 */
export function leadsParamsToState(params) {
  const get = (k) => params.get(k) ?? "";
  const preset = isOn(get("Overdue")) ? "overdue"
    : isOn(get("Unassigned")) ? "unassigned"
      : get("StatusCode") === "lost" ? "lost"
        : "all";
  return {
    preset,
    filters: {
      StatusId: idParam(get("StatusId")), ProductId: idParam(get("ProductId")), OwnerId: idParam(get("OwnerId")),
      SourceId: idParam(get("SourceId")), BranchId: idParam(get("BranchId")),
    },
    range: { from: ISO_DAY.test(get("from")) ? get("from") : "", to: ISO_DAY.test(get("to")) ? get("to") : "" },
  };
}
