// Pure helpers for the calling screen (149, spec §14). Dates are the phone's
// local wall clock (IST for every user), never toISOString().
import type { CallContact, CallResult, MyCallList } from "../../types/api";
import { addDays, clock, localDay, parseDate } from "../sales/leadHelpers";

export const RESULT_LABELS: Record<CallResult | "interested", string> = {
  no_answer: "No answer",
  busy: "Busy",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  callback: "Call back",
  dnc: "Do not call",
  interested: "Interested",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" in the phone's local time. */
export const localDateTime = (d: Date): string => `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const at = (day: Date, h: number) => `${localDay(day)}T${pad(h)}:00`;

export type CallbackKey = "none" | "evening" | "tomorrow" | "pick";

/** The call-back step. "Today evening" only while 6 pm is at least half an hour away. */
export function callbackChoices(now: Date): { key: CallbackKey; label: string; at: string | null }[] {
  const late = now.getHours() * 60 + now.getMinutes() >= 17 * 60 + 30;
  return [
    { key: "none", label: "No time", at: null },
    ...(late ? [] : [{ key: "evening" as const, label: "Today evening", at: at(now, 18) }]),
    { key: "tomorrow", label: "Tomorrow", at: at(addDays(now, 1), 11) },
    { key: "pick", label: "Pick date & time", at: null },
  ];
}

/** Name, else company, else the number. */
export const titleOf = (c: CallContact): string => c.Name?.trim() || c.Company?.trim() || c.Mobile;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};

/** "3rd try · no answer yesterday 4:10 pm"; null for a contact never tried. */
export function historyLine(c: CallContact, now: Date): string | null {
  if (c.Attempts === 0 && !c.LastResult) return null;
  const parts = [`${ordinal(c.Attempts + 1)} try`];
  if (c.LastResult) {
    const d = parseDate(c.LastCalledAt);
    let when = "";
    if (d) {
      const day = localDay(d);
      const name = day === localDay(now) ? "today" : day === localDay(addDays(now, -1)) ? "yesterday" : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
      when = ` ${name} ${clock(d)}`;
    }
    parts.push(`${RESULT_LABELS[c.LastResult].toLowerCase()}${when}`);
  }
  return parts.join(" · ");
}

/** The To call tab with nothing in it, by the server's reason. */
export function emptyCopy(head: MyCallList["head"]): { title: string; body: string } {
  switch (head.EmptyReason) {
    case "hours": return { title: "Outside calling hours", body: "New contacts arrive during calling hours." };
    case "paused": return { title: "Calling is paused", body: "Your manager has paused this list." };
    case "finished": return { title: "This list is finished", body: "Every contact has been called." };
    default: return { title: "All called", body: "Ask your manager for more." };
  }
}

/** A booked callback whose time has passed. */
export const isOverdue = (c: CallContact, now: Date): boolean => {
  const d = parseDate(c.CallbackAt);
  return d != null && d.getTime() < now.getTime();
};
