// Port of web/src/utils/tatChip.js. All times are shown in IST, computed by
// hand (fixed +05:30, no DST) so it does not depend on Hermes' Intl timeZone.
import {
  CirclePause,
  Clock,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react-native";

import type { TaskTatEvent } from "../../types/api";
import type { ChipTone } from "../../ui";

const IST_MS = 330 * 60000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** A DB wall-clock string ("2026-10-08 17:00:00", CONVERT style 120) — already IST. */
export const isWallClock = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v);

/** A DB wall-clock string ("2026-10-08 17:00:00") is IST; anything else is an instant. */
export function parseIst(v: string | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  const d = isWallClock(v)
    ? new Date(`${v.slice(0, 10)}T${v.slice(11, 19).padEnd(8, ":00")}+05:30`)
    : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ist = (d: Date) => {
  const s = new Date(d.getTime() + IST_MS);
  return {
    day: p2(s.getUTCDate()),
    key: `${s.getUTCFullYear()}-${s.getUTCMonth()}-${s.getUTCDate()}`,
    month: MONTHS[s.getUTCMonth()]!,
    year: s.getUTCFullYear(),
    weekday: DAYS[s.getUTCDay()]!,
    time: `${p2(s.getUTCHours())}:${p2(s.getUTCMinutes())}`,
  };
};

/** "17:30 IST" on the same IST day as `now`, else "Tue 11:00 IST". */
export function istShort(value: string | Date | null | undefined, now = new Date()): string {
  const d = parseIst(value);
  if (!d) return "";
  const a = ist(d);
  return `${a.key === ist(now).key ? "" : `${a.weekday} `}${a.time} IST`;
}

/** "08 Oct 2026, 17:30 IST". */
export function istStamp(value: string | Date | null | undefined): string {
  const d = parseIst(value);
  if (!d) return "";
  const a = ist(d);
  return `${a.day} ${a.month} ${a.year}, ${a.time} IST`;
}

/** "08 Oct 2026" — the IST day; "" when there is no parseable date. */
export function istDay(value: string | Date | null | undefined): string {
  const d = parseIst(value);
  if (!d) return "";
  const a = ist(d);
  return `${a.day} ${a.month} ${a.year}`;
}

/** 25m · 3h 10m · 2d 4h. */
export function overBy(ms: number): string {
  const mins = Math.max(1, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

export const VERDICT_LABEL: Record<string, string> = {
  excused: "Delay accepted",
  not_excused: "Delay rejected",
};

/** One line per tblTaskTatEvent row. A due move (any Kind) carries old → new wall-clock values. */
export function eventText(e: Pick<TaskTatEvent, "Kind" | "OldValue" | "NewValue">): string {
  if (isWallClock(e.NewValue)) {
    const now = parseIst(e.NewValue)!;
    return e.OldValue
      ? `Deadline changed ${istShort(e.OldValue, now).replace(" IST", "")} → ${istShort(e.NewValue, now)}`
      : `Due set to ${istShort(e.NewValue, now)}`;
  }
  switch (e.Kind) {
    case "assign": return "Assigned";
    case "reopen": return "Reopened";
    case "resume": return "Timer restarted";
    case "hold":
      return e.NewValue === "blocked" ? "On hold: blocked by a dependency" : `Put on hold: ${e.NewValue ?? ""}`.trim();
    case "release":
      return e.NewValue === "auto" ? "Resumed automatically"
        : e.NewValue === "blocked" ? "Dependency done, timer running" : "Resumed";
    case "acknowledge": return "Accepted";
    case "my_part_done": return "Marked their part done";
    case "reason": return `Reason given: ${e.NewValue ?? ""}`.trim();
    case "verdict": return `Decision: ${(e.NewValue && VERDICT_LABEL[e.NewValue]) ?? e.NewValue ?? ""}`.trim();
    default: return e.Kind;
  }
}

interface TatFields {
  TatDueAt?: string | null;
  TatWarnAt?: string | null;
  TatHeldSince?: string | null;
  TatHoldReason?: string | null;
}

export interface TatChipSpec {
  tone: ChipTone;
  text: string;
  icon: LucideIcon;
}

export function tatChip(task: TatFields | null | undefined, now = new Date()): TatChipSpec | null {
  if (!task || (!task.TatDueAt && !task.TatHeldSince)) return null;
  if (task.TatHeldSince) {
    return { tone: "neutral", text: `On hold: ${task.TatHoldReason || "Blocked"}`, icon: CirclePause };
  }
  const due = parseIst(task.TatDueAt);
  if (!due) return null;
  if (now > due) return { tone: "danger", text: `Late by ${overBy(now.getTime() - due.getTime())}`, icon: OctagonAlert };
  const warn = parseIst(task.TatWarnAt);
  return {
    tone: warn && warn <= now ? "warning" : "info",
    text: `Due ${istShort(due, now)}`,
    icon: warn && warn <= now ? TriangleAlert : Clock,
  };
}
