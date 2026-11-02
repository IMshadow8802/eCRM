import { fetchTickets, type FetchTicketsParams } from "../../api/ticketQueries";
import type {
  CustomFieldDef,
  CustomFieldValue,
  Lookup,
  Ticket,
  TicketStatusCode,
} from "../../types/api";

// ---------------------------------------------------------------- lookups

/** `{Id: Value}` for the few ids a row does not carry a name for. */
export const lookupMap = (lookups: Lookup[] | undefined): Map<number, string> =>
  new Map((lookups ?? []).map((l) => [l.Id, l.Value]));

export const asOptions = (lookups: Lookup[] | undefined) =>
  (lookups ?? []).map((l) => ({ value: l.Id, label: l.Value }));

// ------------------------------------------------------------------ queues

/** The complaint queues — WHICH rows. A status pill then narrows within one. */
export type ComplaintQueue = "mine" | "team" | "unassigned" | "overdue" | "escalated";

/**
 * "all" = no status filter (no longer a pill — the list opens on Active); "active" = open + onhold (what
 * Home, the presets, Search and the first pill mean); a number = one ticket_status id.
 */
export type ComplaintStatusFilter = "all" | "active" | number;

/**
 * Which server-side filters each queue is, in one place, so the list, its
 * preset counts and Home's numbers cannot disagree about what "Mine" means.
 *
 *   mine       assigned to me
 *   team       everything I can see — scope is the SP's
 *   unassigned nobody has it (web's preset of the same name)
 *   overdue    non-terminal and past DueAt (the SP computes it; never stored)
 *   escalated  non-terminal and (escalated to me OR overdue under me) — §7.7
 *
 * A status id replaces StatusCode: sending both would AND them, and
 * "Resolved" within "active" is the empty set. PageSize 50 (the controller
 * caps it at 200); a count overrides it with 1.
 */
export function complaintQueueParams(
  queue: ComplaintQueue,
  status: ComplaintStatusFilter,
  userId: number | null,
  term: string,
): FetchTicketsParams {
  return {
    PageSize: 50,
    SearchTerm: term || null,
    AssignedTo: queue === "mine" ? userId : null,
    StatusCode: status === "active" ? "active" : null,
    StatusId: typeof status === "number" ? status : null,
    Unassigned: queue === "unassigned",
    Overdue: queue === "overdue",
    Escalated: queue === "escalated",
  };
}

/**
 * A count (G13): the same filters at PageSize 1, under `["tickets", "count",
 * params]` — Home's key, so a preset count and Home's number are one request.
 */
export const complaintCountQuery = (params: FetchTicketsParams) => ({
  queryKey: ["tickets", "count", params],
  queryFn: () => fetchTickets({ ...params, PageSize: 1 }),
});

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

/** The company's first status row with this code (Code, never a label). */
export const statusFor = (
  statuses: Lookup[],
  code: TicketStatusCode,
): Lookup | undefined => statuses.find((s) => asStatusCode(s.Code) === code);

// ------------------------------------------------------------ E's wording

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "5:30 pm" */
export const clock = (d: Date): string =>
  `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "am" : "pm"}`;

/** "Tue, 3 Nov" */
export const dayMonth = (d: Date): string =>
  `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** "40 m" / "2 h" / "3 d" — whole units, never "1.5 h". */
export const span = (ms: number): string => {
  const mins = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (mins < 60) return `${mins} m`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs} h` : `${Math.round(hrs / 24)} d`;
};

/** A time today reads as the clock ("2:05 pm"), any other day as the date. */
export const whenText = (iso: string | null | undefined, now = new Date()): string => {
  const d = parse(iso);
  return d ? (sameDay(d, now) ? clock(d) : dayMonth(d)) : "";
};

/** "Opened Mon, 2 Nov · 10:30 am" — the record band's subtitle. */
export const openedText = (iso: string): string => {
  const d = parse(iso);
  return d ? `Opened ${dayMonth(d)} · ${clock(d)}` : "";
};

/** When it is due: "12:40 pm" today, else "Tue, 3 Nov, 5:30 pm". */
export const dueWhen = (iso: string | null | undefined, now = new Date()): string | null => {
  const d = parse(iso);
  if (!d) return null;
  return sameDay(d, now) ? clock(d) : `${dayMonth(d)}, ${clock(d)}`;
};

export type DueTone = "default" | "danger" | "success";

type DueFields = Pick<Ticket, "DueAt" | "IsOverdue" | "StatusCode" | "ResolvedAt" | "ClosedAt" | "UpdatedAt">;

/**
 * The right side of a list row (E 10): "Overdue 2 h" (danger) · "Due 5:30 pm"
 * today · "Tue, 3 Nov" later · "Done 1:10 pm" (success) on a resolved one ·
 * the day it closed on a closed or rejected one. Null when there is no clock.
 *
 * Overdue is the row's `IsOverdue` alone — the SP's clock decides it, the
 * device clock only phrases the gap.
 */
export function rowDue(ticket: DueFields, now = new Date()): { text: string; tone: DueTone } | null {
  const code = lifecycleOf(ticket);
  if (code === "resolved") {
    return parse(ticket.ResolvedAt) ? { text: `Done ${whenText(ticket.ResolvedAt, now)}`, tone: "success" } : null;
  }
  if (isTerminal(code)) {
    const at = ticket.ClosedAt ?? ticket.UpdatedAt;
    return parse(at) ? { text: whenText(at, now), tone: "default" } : null;
  }
  const due = parse(ticket.DueAt);
  if (!due) return null;
  if (ticket.IsOverdue) return { text: `Overdue ${span(now.getTime() - due.getTime())}`, tone: "danger" };
  return { text: sameDay(due, now) ? `Due ${clock(due)}` : dayMonth(due), tone: "default" };
}

/**
 * The Due fact (E 11): "12:40 pm · 2 h over" while overdue, else when it is
 * due. A terminal ticket keeps the time it was due — the clock stopped, the
 * time did not.
 */
export function dueFact(
  ticket: Pick<Ticket, "DueAt" | "IsOverdue" | "StatusCode">,
  now = new Date(),
): { text: string; overdue: boolean } | null {
  const when = dueWhen(ticket.DueAt, now);
  if (!when) return null;
  if (!ticket.IsOverdue || isTerminal(lifecycleOf(ticket))) return { text: when, overdue: false };
  return { text: `${when} · ${span(now.getTime() - new Date(ticket.DueAt!).getTime())} over`, overdue: true };
}

/**
 * "4 working hours" for a priority's TatHours — the form's hint. Null = no
 * clock. Never "3 days": since P4 they are hours on the assignee's shift, so
 * 72 of them is far more than three calendar days.
 */
export const tatLabel = (hours: number | null | undefined): string | null =>
  hours == null ? null : `${hours} working hour${hours === 1 ? "" : "s"}`;

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

/** The EAV row as one line of text: Yes/No, the number, the date, the text. */
export function customValue(field: CustomFieldValue): string {
  if (field.Type === "checkbox") {
    return field.ValueText === "true" || field.ValueNumber === 1 ? "Yes" : "No";
  }
  if (field.Type === "number") return field.ValueNumber?.toString() ?? "—";
  if (field.Type === "date") return field.ValueDate ? field.ValueDate.slice(0, 10) : "—";
  return field.ValueText || "—";
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
