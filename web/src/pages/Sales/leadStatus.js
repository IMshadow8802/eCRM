import dayjs from "dayjs";
import { reportKey } from "../../styles/tokens";
import { readRange, writeRange } from "../../utils/datePresets";

// The lookup's Code is the machine meaning behind an editable label.
// open | qualified = still being worked; lost | junk | converted (won) = closed.
export const isActiveCode = (code) => code === "open" || code === "qualified";

export const LEAD_PRESETS = [
  { value: "all", label: "All" },
  { value: "mine", label: "My leads" },
  { value: "overdue", label: "Overdue" },
  { value: "unassigned", label: "Unassigned" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export const presetParams = (preset, userId) => {
  switch (preset) {
    case "mine": return { OwnerId: userId };
    case "overdue": return { Overdue: true };
    case "unassigned": return { Unassigned: true };
    case "won": return { StatusCode: "converted" };
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

// An open lead with nothing on it for this many whole days is going cold.
export const STALE_DAYS = 7;

export function isStale(lead, now = new Date()) {
  const at = lead.LastActivityAt ?? lead.CreatedAt;
  return isActiveCode(lead.StatusCode) && Boolean(at) && dayjs(now).diff(dayjs(at), "day") >= STALE_DAYS;
}

// Won / lost chips take the report colour key; open statuses keep the brand tone.
export const statusChipColors = (code) => {
  const key = { converted: "won", lost: "lost" }[code];
  return key ? { bg: reportKey[key].bg, text: reportKey[key].text } : undefined;
};

// The sort names sp_FetchLeads understands (= the sortable columns' ids).
export const LEAD_SORTS = ["name", "created", "lastActivity", "value", "nextFollowUp"];
const FILTER_KEYS = ["StatusId", "ProductId", "OwnerId", "SourceId", "BranchId", "PartnerId"];
const RANGE = { key: "created", defaultPreset: "any" };

const idParam = (v) => (v && /^\d+$/.test(v) ? Number(v) : "");

/**
 * Leads-list state from the address bar: the id filters, the Created range
 * (created / from / to) and the sort (sort / dir). Anything unreadable falls
 * back to its default; "" is the filters' own empty value, so the Comboboxes
 * stay controlled.
 */
export function leadsParamsToState(params, today = dayjs()) {
  const sort = params.get("sort");
  return {
    filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, idParam(params.get(k))])),
    created: readRange(params, { ...RANGE, allowAny: true, today }),
    // No sort until the user picks one: the proc's own order applies (newest
    // first; most overdue first on the Overdue tab), so no column shows an arrow.
    sorting: LEAD_SORTS.includes(sort) ? [{ id: sort, desc: params.get("dir") !== "asc" }] : [],
  };
}

// The reverse: only what differs from the defaults goes into the address bar.
export function leadsStateToParams({ filters, created, sorting }) {
  const out = {};
  for (const k of FILTER_KEYS) if (filters[k] !== "" && filters[k] != null) out[k] = String(filters[k]);
  Object.assign(out, writeRange(created, RANGE));
  const s = sorting[0];
  if (s) Object.assign(out, { sort: s.id, dir: s.desc ? "desc" : "asc" });
  return out;
}
