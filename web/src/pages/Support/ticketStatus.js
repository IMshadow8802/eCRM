// src/pages/Support/ticketStatus.js
//
// The lookup's Code is the machine meaning behind an editable label (spec 2
// §1): open | onhold = active, resolved | closed | rejected = terminal. Nothing
// in the UI matches on a status *name* — companies rename them.
import dayjs from "dayjs";

import { formatDate } from "../../utils/format";

export const isActiveCode = (code) => code === "open" || code === "onhold";
export const isTerminalCode = (code) => code === "resolved" || code === "closed" || code === "rejected";

export const TICKET_PRESETS = [
  { value: "mine", label: "My queue" },
  { value: "team", label: "My team" },
  { value: "unassigned", label: "Unassigned" },
  { value: "overdue", label: "Overdue" },
  { value: "escalated", label: "Escalated" },
  { value: "onhold", label: "On hold" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/** Preset -> fetchTickets params. `active` = open + onhold (sp_FetchTickets @StatusCode). */
export const presetParams = (preset, userId) => {
  switch (preset) {
    case "mine": return { AssignedTo: userId, StatusCode: "active" };
    case "team": return { StatusCode: "active" };
    case "unassigned": return { Unassigned: 1, StatusCode: "active" };
    case "overdue": return { Overdue: 1 };
    case "escalated": return { Escalated: 1 };
    case "onhold": return { StatusCode: "onhold" };
    case "closed": return { StatusCode: "closed" };
    default: return {};
  }
};

const TONES = { open: "info", onhold: "warning", resolved: "success", closed: "default", rejected: "error" };
/** Chip tone for a status code — the same colour language on the list, the detail and the customer page. */
export const statusTone = (code) => TONES[code] ?? "default";

// "20m" under an hour, "47h" under two days, "2d" after that.
const span = (mins) =>
  mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;

/**
 * Relative due label. `isOverdue` is the server's word (IsOverdue = active AND
 * DueAt < now); a past due date that is NOT overdue belongs to a resolved /
 * closed complaint and reads as a plain date.
 */
export function dueLabel(dueAt, isOverdue, now = dayjs()) {
  if (!dueAt) return "—";
  const mins = dayjs(dueAt).diff(now, "minute");
  if (isOverdue) return `${span(Math.abs(mins))} overdue`;
  if (mins >= 0) return `in ${span(mins)}`;
  return formatDate(dueAt);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const idParam = (v) => (v && /^\d+$/.test(v) ? Number(v) : "");
const isOn = (v) => v === "1" || v === "true";
const FILTER_KEYS = ["StatusId", "Priority", "CategoryId", "ChannelId", "ProductId", "AssignedTo", "BranchId"];

/**
 * Tickets-list state from URL search params, mirroring leadsParamsToState:
 * a named `preset` wins, else the flag params pick a tab, else "team". "" is
 * the filters' own empty value so the Comboboxes stay controlled.
 */
export function ticketsParamsToState(params) {
  const get = (k) => params.get(k) ?? "";
  const named = get("preset");
  const preset = TICKET_PRESETS.some((x) => x.value === named) ? named
    : isOn(get("Overdue")) ? "overdue"
      : isOn(get("Escalated")) ? "escalated"
        : isOn(get("Unassigned")) ? "unassigned"
          : get("StatusCode") === "onhold" ? "onhold"
            : get("StatusCode") === "closed" ? "closed"
              : "team";
  return {
    preset,
    filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, idParam(get(k))])),
    range: { from: ISO_DAY.test(get("from")) ? get("from") : "", to: ISO_DAY.test(get("to")) ? get("to") : "" },
  };
}
