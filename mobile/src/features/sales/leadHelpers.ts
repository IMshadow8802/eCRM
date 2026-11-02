import type { FetchFollowUpsParams } from "../../api/followupQueries";
import { fetchLeads, type FetchLeadsParams } from "../../api/leadQueries";
import type { FollowUp, FollowUpType, Lead, Lookup } from "../../types/api";
import { leadBadge, type BadgeSpec } from "../../theme/statusBadges";

// --------------------------------------------------------------- lifecycle

/**
 * open | qualified are still being worked; converted (Won) | lost | junk are closed.
 * A row with no Code is NOT active — same as the web's isActiveCode and the
 * server's overdue rule (Code IN ('open','qualified')), so both clients agree.
 */
export const isActiveLead = (code: string | null | undefined): boolean => code === "open" || code === "qualified";

/** The status a new lead starts in: the first `open` row, else the first row. */
export const defaultStatus = (statuses: Lookup[]): number | null =>
  (statuses.find((s) => s.Code === "open") ?? statuses[0])?.Id ?? null;

const openRows = (statuses: Lookup[]) =>
  statuses.filter((s) => s.Code === "open").sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0));

/** G1: the place of a status among the `open`-coded ones by SortOrder (0 = New). */
export const openRank = (statuses: Lookup[], statusId: number | null | undefined): number =>
  Math.max(0, openRows(statuses).findIndex((s) => s.Id === statusId));

/** The "New" preset's status: the first `open`-coded row by SortOrder. */
export const firstOpenStatus = (statuses: Lookup[]): number | null => openRows(statuses)[0]?.Id ?? null;

/** Badge + pill tone for a lead status (theme §1.6 with the G1 rank). */
export const leadStatusBadge = (
  statuses: Lookup[],
  code: string | null | undefined,
  statusId: number | null | undefined,
): BadgeSpec => leadBadge(code, openRank(statuses, statusId));

// ----------------------------------------------------------------- queues

export type LeadQueue = "mine" | "all" | "overdue" | "new" | "unassigned";

/** E's four presets, plus Unassigned as the fifth (user decision §7.1). */
export const LEAD_QUEUES: { value: LeadQueue; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "new", label: "New" },
  { value: "unassigned", label: "Unassigned" },
];

/** "all" = no status filter; a number = one lead_status id. */
export type LeadStatusFilter = "all" | number;

/**
 * Same meanings as the web's presets (pages/Sales/leadStatus.js). Paging is the caller's.
 * `userId` is required: a null OwnerId would turn "Mine" into the whole reach, so
 * screens must not build a queue before auth has loaded. `New` is the whole
 * reach in `newStatusId` (firstOpenStatus); a screen must not query New before
 * that id is known, or it would list every status.
 */
export const leadQueueParams = (
  queue: LeadQueue,
  status: LeadStatusFilter,
  userId: number,
  term: string,
  newStatusId: number | null = null,
): FetchLeadsParams => ({
  PageSize: 50,
  SearchTerm: term || null,
  OwnerId: queue === "mine" ? userId : null,
  Overdue: queue === "overdue",
  Unassigned: queue === "unassigned",
  StatusId: queue === "new" ? newStatusId : status === "all" ? null : status,
});

/**
 * A count (G13): one PageSize 1 request per preset or pill, cached by its params —
 * Leads' presets and Home's team card read this, so a number equals the list it opens.
 */
export const leadCountQuery = (params: FetchLeadsParams | null, idle: string) => ({
  // A not-yet-askable count is keyed by its name, so two of them are not one query.
  queryKey: ["leads", "count", params ?? idle],
  queryFn: () => fetchLeads({ ...params, PageSize: 1, PageNumber: 1 }),
  enabled: params != null,
});

/** G3: one page this big is summed; a longer list has no open value. */
export const OPEN_VALUE_PAGE = 200;

/** G3: EstValue over a list's open and qualified leads; null when the list is longer than one 200-row page. */
export const openValue = (leads: Lead[], totalRecords: number): number | null =>
  totalRecords > OPEN_VALUE_PAGE
    ? null
    : leads.reduce((sum, l) => sum + (isActiveLead(l.StatusCode) ? (l.EstValue ?? 0) : 0), 0);

export type FollowUpView = "today" | "overdue" | "upcoming" | "all";

/** E's three views, plus All as the fourth (user decision §7.3). */
export const FOLLOWUP_VIEWS: { value: FollowUpView; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All" },
];

/** The web queue's views (pages/Sales/FollowUps.jsx). The caller adds PageNumber. */
export function followUpViewParams(view: FollowUpView, now = new Date()): FetchFollowUpsParams {
  const today = localDay(now);
  switch (view) {
    case "today":
      return { Status: "open", DueFrom: today, DueTo: today };
    case "overdue":
      return { Overdue: true };
    case "upcoming":
      return { Status: "open", DueFrom: localDay(addDays(now, 1)) };
    default:
      return {};
  }
}

/**
 * G20 "Done today" (SQL 118): done follow-ups whose DoneAt is today. DoneTo is
 * an EXCLUSIVE instant, so "through today" is tomorrow 00:00. `sp_SkipFollowUp`
 * stamps DoneAt too, which is why Status: done is sent. A DB without 118
 * rejects the call; the screen shows "—".
 */
export const doneTodayParams = (now = new Date()): FetchFollowUpsParams => ({
  Status: "done",
  DoneFrom: localDay(now),
  DoneTo: localDay(addDays(now, 1)),
});

// ------------------------------------------------------------- follow-ups

export const FOLLOWUP_TYPES: { value: FollowUpType; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "visit", label: "Visit" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

export const followUpTypeLabel = (type: string | null | undefined): string =>
  FOLLOWUP_TYPES.find((t) => t.value === type)?.label ?? "Follow-up";

/** Due dates on a phone are a tap: the four days people actually book. */
export const WHEN_CHOICES = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "3days", label: "In 3 days" },
  { value: "week", label: "Next week" },
] as const;

export type WhenChoice = (typeof WHEN_CHOICES)[number]["value"];

const WHEN_DAYS: Record<WhenChoice, number> = { today: 0, tomorrow: 1, "3days": 3, week: 7 };

/** Local 'YYYY-MM-DD' for a when-choice. */
export const dueFromChoice = (choice: WhenChoice, now = new Date()): string =>
  localDay(addDays(now, WHEN_DAYS[choice]));

/** The lead form's first follow-up (E 16): a day, a picked date, or none. */
export const FIRST_FOLLOWUPS = [
  { value: "tomorrow", label: "Tomorrow" },
  { value: "3days", label: "In 3 days" },
  { value: "pick", label: "Pick date" },
  { value: "none", label: "None" },
] as const;
export type FirstFollowUp = (typeof FIRST_FOLLOWUPS)[number]["value"];

/** First open follow-up — the one "Log follow-up" completes. */
export const nextOpen = (followups: FollowUp[]): FollowUp | undefined => followups.find((f) => f.Status === "open");

// ------------------------------------------------------------------ dates

const pad = (n: number) => String(n).padStart(2, "0");

/** Local Y-M-D. Never toISOString(): that is UTC and rolls the day back in IST. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const addDays = (d: Date, n: number): Date => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A server date: a bare 'YYYY-MM-DD' is a local day, not UTC midnight. */
export const parseDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const hasTime = (d: Date) => d.getHours() !== 0 || d.getMinutes() !== 0;

/** "Today" / "Tomorrow" / "Yesterday" / "12 Nov" / "12 Nov 2025" — the local day of an instant. */
export function dayLabel(iso: string | null | undefined, now = new Date()): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  const day = localDay(d);
  if (day === localDay(now)) return "Today";
  if (day === localDay(addDays(now, 1))) return "Tomorrow";
  if (day === localDay(addDays(now, -1))) return "Yesterday";
  const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

/** "Tue, 3 Nov" */
export const shortDay = (d: Date): string => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** "11:00 am" / "5:05 pm" */
export const clock = (d: Date): string =>
  `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "am" : "pm"}`;

/** "today 4:30 pm" · "tomorrow 11:00 am" · "Wed, 4 Nov 10:30 am"; no time when the day has none. */
export function whenText(iso: string | null | undefined, now = new Date()): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  const day = localDay(d);
  const name = day === localDay(now) ? "today" : day === localDay(addDays(now, 1)) ? "tomorrow" : shortDay(d);
  return hasTime(d) ? `${name} ${clock(d)}` : name;
}

/** "in 20 h" · "in 20 min" · "in 4 d" · "2 h ago" */
export function fromNow(iso: string | null | undefined, now = new Date()): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  const minutes = Math.round((d.getTime() - now.getTime()) / 60000);
  const abs = Math.abs(minutes);
  const span = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`;
  return minutes >= 0 ? `in ${span}` : `${span} ago`;
}

/**
 * G2: a lead row's third line. The API has only the date of the next
 * follow-up, not its type, so it reads "Follow-up …". A closed lead owes nothing.
 */
export function followUpLine(lead: Lead, now = new Date()): { text: string; tone: "default" | "danger" | "muted" } {
  const d = isActiveLead(lead.StatusCode) ? parseDate(lead.NextFollowupDate) : null;
  if (!d) return { text: "No follow-up planned", tone: "muted" };
  if (lead.IsOverdue) {
    return { text: `Follow-up overdue · ${shortDay(d)}${hasTime(d) ? ` ${clock(d)}` : ""}`, tone: "danger" };
  }
  return { text: `Follow-up ${whenText(lead.NextFollowupDate, now)}`, tone: "default" };
}

/** A follow-up's meta (E 15): "Visit · Sat, 7 Nov · 3:00 pm", or "Call · Thu, 29 Oct · done". */
export function followUpMeta(f: FollowUp): string {
  const open = f.Status === "open";
  const d = parseDate(open ? f.DueAt : (f.DoneAt ?? f.DueAt));
  const tail = open ? (d && hasTime(d) ? clock(d) : null) : f.Status === "done" ? "done" : "skipped";
  return [followUpTypeLabel(f.Type), d ? shortDay(d) : null, tail].filter(Boolean).join(" · ");
}

/** `day` at the time of day of `iso` ("2026-11-05T15:30"); a bare day when `iso` has none. */
export function onDayAtTimeOf(iso: string | null | undefined, day: string): string {
  const d = parseDate(iso);
  return d && hasTime(d) ? `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

/** "Tue, 3 Nov · 11:00 am" — the next-follow-up card's title. */
export function dueTitle(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "—";
  return hasTime(d) ? `${shortDay(d)} · ${clock(d)}` : shortDay(d);
}

/** ₹ with Indian grouping, no paise. */
export const rupees = (value: number | null | undefined): string | null =>
  value == null ? null : `₹${Math.round(value).toLocaleString("en-IN")}`;
