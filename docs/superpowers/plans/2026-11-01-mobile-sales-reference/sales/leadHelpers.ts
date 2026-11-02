import type { FetchLeadsParams } from "../../api/leadQueries";
import type { FetchFollowUpsParams } from "../../api/followupQueries";
import type { FollowUp, FollowUpType, Lookup } from "../../types/api";
import type { ChipTone } from "../../ui";

// --------------------------------------------------------------- lifecycle

/** open | qualified are still being worked; converted (Won) | lost | junk are closed. */
export const isActiveLead = (code: string | null | undefined): boolean =>
  code === "open" || code === "qualified" || code == null;

export function leadTone(code: string | null | undefined): ChipTone {
  switch (code) {
    case "qualified":
      return "info";
    case "converted":
      return "success";
    case "lost":
      return "danger";
    case "junk":
      return "neutral";
    default:
      return "primary";
  }
}

/** The status a new lead starts in: the first `open` row, else the first row. */
export const defaultStatus = (statuses: Lookup[]): number | null =>
  (statuses.find((s) => s.Code === "open") ?? statuses[0])?.Id ?? null;

// ----------------------------------------------------------------- queues

export type LeadQueue = "mine" | "all" | "overdue" | "unassigned";

export const LEAD_QUEUES: { value: LeadQueue; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "unassigned", label: "Unassigned" },
];

/** "all" = no status filter; a number = one lead_status id. */
export type LeadStatusFilter = "all" | number;

/** Same meanings as the web's presets (pages/Sales/leadStatus.js). */
export function leadQueueParams(
  queue: LeadQueue,
  status: LeadStatusFilter,
  userId: number | null,
  term: string,
): FetchLeadsParams {
  return {
    PageSize: 100,
    SearchTerm: term || null,
    OwnerId: queue === "mine" ? userId : null,
    Overdue: queue === "overdue",
    Unassigned: queue === "unassigned",
    StatusId: status === "all" ? null : status,
  };
}

export type FollowUpView = "today" | "overdue" | "upcoming" | "all";

export const FOLLOWUP_VIEWS: { value: FollowUpView; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All" },
];

/** Exactly the web queue's views (pages/Sales/FollowUps.jsx). */
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

// ------------------------------------------------------------- follow-ups

export const FOLLOWUP_TYPES: { value: FollowUpType; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "visit", label: "Visit" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

export const followUpTypeLabel = (type: string | null | undefined): string =>
  FOLLOWUP_TYPES.find((t) => t.value === type)?.label ?? "Follow-up";

/**
 * Due dates on a phone are a tap, not a calendar: the four days people
 * actually book. A specific date is still possible on the web.
 */
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

/** First open follow-up — the one the "Log" quick action completes. */
export const nextOpen = (followups: FollowUp[]): FollowUp | undefined =>
  followups.find((f) => f.Status === "open");

// ------------------------------------------------------------------ dates

const pad = (n: number) => String(n).padStart(2, "0");

/** Local Y-M-D. Never toISOString(): that is UTC and rolls the day back in IST. */
export const localDay = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const addDays = (d: Date, n: number): Date => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today" / "Tomorrow" / "Yesterday" / "12 Nov" — the day of a datetime instant. */
export function dayLabel(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = localDay(d);
  if (day === localDay(now)) return "Today";
  if (day === localDay(addDays(now, 1))) return "Tomorrow";
  if (day === localDay(addDays(now, -1))) return "Yesterday";
  const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

/** ₹ with Indian grouping, no paise. */
export const rupees = (value: number | null | undefined): string | null =>
  value == null ? null : `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
