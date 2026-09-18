import type {
  CustomFieldDef,
  CustomFieldValue,
  Lookup,
  Ticket,
  TicketStatusCode,
} from "../../types/api";
import type { ChipTone } from "../../ui";

// ---------------------------------------------------------------- lookups

/** `{Id: Value}` for the few ids a row does not carry a name for. */
export const lookupMap = (lookups: Lookup[] | undefined): Map<number, string> =>
  new Map((lookups ?? []).map((l) => [l.Id, l.Value]));

export const asOptions = (lookups: Lookup[] | undefined) =>
  (lookups ?? []).map((l) => ({ value: l.Id, label: l.Value }));

// --------------------------------------------------------------- lifecycle

const CODES: ReadonlySet<string> = new Set<TicketStatusCode>([
  "open",
  "onhold",
  "resolved",
  "closed",
  "rejected",
]);

/**
 * Normalises whatever the API sent to one of the five codes. sp_SaveLookup
 * rejects anything else for `ticket_status`, so the fallback only ever meets a
 * NULL — read as open, the one reading that cannot hide work.
 */
export const asStatusCode = (
  code: string | null | undefined,
): TicketStatusCode =>
  code && CODES.has(code) ? (code as TicketStatusCode) : "open";

/**
 * Where a ticket sits, read from its status CODE — never from its label
 * (per-company, editable) and never from its timestamps.
 */
export const lifecycleOf = (
  ticket: Pick<Ticket, "StatusCode">,
): TicketStatusCode => asStatusCode(ticket.StatusCode);

/** Still being worked: open or on hold. */
export const isActive = (code: TicketStatusCode): boolean =>
  code === "open" || code === "onhold";

/** Resolved, closed or rejected — nothing left to do unless it is reopened. */
export const isTerminal = (code: TicketStatusCode): boolean => !isActive(code);

export const STATUS_TONE: Record<TicketStatusCode, ChipTone> = {
  open: "info",
  onhold: "warning",
  resolved: "success",
  closed: "neutral",
  rejected: "danger",
};

export const statusTone = (code: TicketStatusCode): ChipTone =>
  STATUS_TONE[code];

/**
 * Priority is a per-company lookup row, so its *name* is the only thing that
 * can be matched on — there is no enum and ids differ between companies.
 * Anything unrecognised falls back to neutral rather than guessing.
 */
export function priorityTone(name: string | null | undefined): ChipTone {
  const key = (name ?? "").toLowerCase();
  if (key.includes("urgent") || key.includes("critical")) return "danger";
  if (key.includes("high")) return "danger";
  if (key.includes("medium") || key.includes("normal")) return "warning";
  if (key.includes("low")) return "success";
  return "neutral";
}

// --------------------------------------------------------------------- TAT

/** "45m" / "4h" / "3d" — whole units, never "1.5h". */
const span = (ms: number): string => {
  const mins = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
};

/**
 * "Due in 4h" / "Overdue by 2d", or null.
 *
 * Null for a terminal ticket (the clock has stopped) and when the priority has
 * no TAT (`DueAt` NULL — such a ticket is never overdue). `overdue` is taken
 * from the row's `IsOverdue` alone, which the SP computes against its own
 * clock — the device clock never decides overdue, it only phrases the gap
 * (`gap`, via `span()`, for the "in 4h" / "by 2d" wording). A phone with a
 * wrong clock would otherwise disagree with the server, the web and every
 * other client about what is late. `DueAt` is a datetime instant (the backend
 * runs `useUTC: false`, pinned to Asia/Kolkata), so plain `new Date()` parsing
 * is right here — unlike a task's date-only DueDate.
 */
export function dueLabel(
  ticket: Pick<Ticket, "DueAt" | "IsOverdue" | "StatusCode">,
  now = new Date(),
): { label: string; overdue: boolean } | null {
  if (!ticket.DueAt || isTerminal(lifecycleOf(ticket))) return null;
  const due = new Date(ticket.DueAt).getTime();
  if (Number.isNaN(due)) return null;
  const gap = due - now.getTime();
  const overdue = Boolean(ticket.IsOverdue);
  return {
    label: overdue ? `Overdue by ${span(gap)}` : `Due in ${span(gap)}`,
    overdue,
  };
}

/** "4h" / "3 days" for a priority's TatHours — the form's hint. Null = no clock. */
export const tatLabel = (hours: number | null | undefined): string | null =>
  hours == null
    ? null
    : hours < 48
      ? `${hours}h`
      : `${Math.round(hours / 24)} days`;

// ------------------------------------------------------------ custom fields

/**
 * A stored value, back in the shape the form edits. The EAV row splits by type
 * across three columns and only one of them is populated.
 */
export function draftFromValues(
  values: CustomFieldValue[],
): Record<number, string | boolean> {
  const draft: Record<number, string | boolean> = {};
  for (const value of values) {
    if (value.Type === "checkbox") {
      draft[value.FieldId] = value.ValueText === "true" || value.ValueNumber === 1;
    } else if (value.Type === "number") {
      draft[value.FieldId] = value.ValueNumber == null ? "" : String(value.ValueNumber);
    } else if (value.Type === "date") {
      draft[value.FieldId] = value.ValueDate ? value.ValueDate.slice(0, 10) : "";
    } else {
      draft[value.FieldId] = value.ValueText ?? "";
    }
  }
  return draft;
}

/** Seed a blank entry per definition so every field is controlled from render one. */
export function blankDraft(
  defs: CustomFieldDef[],
): Record<number, string | boolean> {
  const draft: Record<number, string | boolean> = {};
  for (const def of defs) draft[def.Id] = def.Type === "checkbox" ? false : "";
  return draft;
}

/** The `CustomJSON` payload sp_SaveTicket expects. */
export const serialiseCustomFields = (
  defs: CustomFieldDef[],
  draft: Record<number, string | boolean>,
): string | null =>
  defs.length
    ? JSON.stringify(
        defs.map((def) => ({
          fieldId: def.Id,
          type: def.Type,
          value: draft[def.Id] ?? (def.Type === "checkbox" ? false : ""),
        })),
      )
    : null;

/** Which required custom fields are still empty. Empty array = good to submit. */
export const missingRequired = (
  defs: CustomFieldDef[],
  draft: Record<number, string | boolean>,
): CustomFieldDef[] =>
  defs.filter((def) => {
    if (!def.IsRequired) return false;
    const value = draft[def.Id];
    // An unticked required checkbox is a genuine "you must agree" — treat
    // false as missing, the same way the web does.
    if (def.Type === "checkbox") return value !== true;
    return !String(value ?? "").trim();
  });
