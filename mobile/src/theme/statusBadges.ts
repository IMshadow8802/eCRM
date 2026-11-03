// src/theme/statusBadges.ts
//
// Status → badge (tone + icon) and chip tone, E §1.6. Pure data: tone NAMES
// only, never a colour, so `StatusBadge`/`Chip` resolve them through the theme.
// Every branch keys on a machine code, never on a company's label.
import {
  Archive, BadgeCheck, Bell, Calendar, CalendarCheck, CalendarClock, CalendarX, ChevronsUp, Check, Circle,
  CircleCheck, CircleDot, CirclePause, CirclePlay, CircleX, Clock, Ellipsis, FileText, Flag, Headset,
  House, Inbox, LayoutDashboard, ListChecks, Lock, MapPin, MessageSquare, OctagonAlert, Pencil, Phone,
  PhoneCall, Plus, Sparkles, SquareCheckBig, Target, Timer, Trophy, UserCheck, UserPlus, Users,
  type LucideIcon,
} from "lucide-react-native";

import type { BadgeTone, ChipTone, UiModule } from "./tokens";

export interface BadgeSpec {
  tone: BadgeTone;
  icon: LucideIcon;
  /** The matching pill tone, where E draws one next to the badge. */
  chip?: ChipTone;
}

const b = (tone: BadgeTone, icon: LucideIcon, chip?: ChipTone): BadgeSpec => (chip ? { tone, icon, chip } : { tone, icon });

/** Module icons: `bar` on the bottom bar and rail, `tile` on Home tiles and Create rows. */
export const moduleIcons: Record<UiModule, { bar: LucideIcon; tile: LucideIcon }> = {
  home: { bar: House, tile: House },
  inbox: { bar: Inbox, tile: Inbox },
  tasks: { bar: SquareCheckBig, tile: ListChecks },
  complaints: { bar: Headset, tile: Headset },
  leads: { bar: Target, tile: Target },
  followups: { bar: CalendarClock, tile: CalendarCheck },
  more: { bar: Ellipsis, tile: Ellipsis },
};

// ---------------------------------------------------------------- complaints
const COMPLAINT: Record<string, BadgeSpec> = {
  open: b("sky", CircleDot, "sky"),
  onhold: b("butter", CirclePause, "butter"),
  resolved: b("green", CircleCheck, "green"),
  closed: b("slate", Archive, "slate"),
  rejected: b("red", CircleX, "red"),
};
/** By `StatusCode`. An unknown code reads as open: it is still somebody's job. */
export const complaintBadge = (code: string | null | undefined): BadgeSpec => COMPLAINT[code ?? ""] ?? COMPLAINT.open!;

/** The escalated corner dot's glyph (StatusBadge draws it) and its pill tone. */
export const escalatedMark = { icon: ChevronsUp, chip: "lilac" as ChipTone };

// --------------------------------------------------------------------- leads
const LEAD_OPEN = [b("sky", Sparkles, "sky"), b("teal", Phone, "teal"), b("butter", FileText, "butter")] as const;
const LEAD: Record<string, BadgeSpec> = {
  qualified: b("lilac", BadgeCheck, "lilac"),
  converted: b("green", Trophy, "green"),
  lost: b("red", CircleX, "red"),
  junk: b("slate", CircleX, "slate"),
};
/**
 * G1: New, Contacted and Proposal all carry `Code = 'open'`, so an open-coded
 * status is told apart by its rank among the open-coded rows by `SortOrder`
 * (0 = first): 0 → new, 1 → contacted, 2+ → proposal.
 */
export function leadBadge(code: string | null | undefined, openRank = 0): BadgeSpec {
  if (code === "open" || !code || !LEAD[code]) return LEAD_OPEN[Math.min(Math.max(openRank, 0), 2)]!;
  return LEAD[code]!;
}

// --------------------------------------------------------------------- tasks
export type TaskStage = "todo" | "inProgress" | "done";
const STAGE: Record<TaskStage, BadgeSpec & { label: string }> = {
  todo: { ...b("slate", Circle, "slate"), label: "To do" },
  inProgress: { ...b("teal", CirclePlay, "teal"), label: "In progress" },
  done: { ...b("green", CircleCheck, "green"), label: "Done" },
};
/** G8: columns are free text, so the stage comes from completion and the checklist. */
export function taskStage(task: { IsCompleted: boolean; ChecklistDone?: number | null }): TaskStage {
  if (task.IsCompleted) return "done";
  return (task.ChecklistDone ?? 0) > 0 ? "inProgress" : "todo";
}
export const taskStageBadge = (stage: TaskStage) => STAGE[stage];

// ------------------------------------------------------------------ priority
const PRIORITY: Record<string, ChipTone> = { urgent: "red", high: "red", medium: "butter", low: "slate" };
/** Complaint flag / task chip: always the flag icon, tone by priority (unknown → slate). */
export const priorityChip = (p: string | null | undefined): { tone: ChipTone; icon: LucideIcon } => ({
  tone: PRIORITY[(p ?? "").toLowerCase()] ?? "slate",
  icon: Flag,
});

// ---------------------------------------------------------------- workspaces
const WORKSPACE: Record<string, BadgeSpec> = {
  personal: b("slate", Lock, "slate"),
  shared: b("teal", Users, "teal"),
  project: b("lilac", LayoutDashboard, "lilac"),
};
export const workspaceBadge = (type: string | null | undefined): BadgeSpec => WORKSPACE[type ?? ""] ?? WORKSPACE.shared!;

// ---------------------------------------------------------------- follow-ups
const FOLLOW_UP: Record<string, BadgeSpec> = {
  call: b("sky", Phone),
  visit: b("teal", MapPin),
  meeting: b("lilac", Users),
};
/**
 * By type; a done row is a green check; an overdue one keeps its type icon on
 * red, a cancelled one (119) on slate; a skipped one is the skip sheet's CalendarX on slate.
 */
export function followUpBadge(
  type: string | null | undefined,
  state: "open" | "done" | "overdue" | "cancelled" | "skipped" = "open",
): BadgeSpec {
  if (state === "done") return b("green", Check);
  if (state === "skipped") return b("slate", CalendarX);
  const spec = FOLLOW_UP[(type ?? "").toLowerCase()] ?? b("slate", CalendarClock);
  if (state === "cancelled") return b("slate", spec.icon);
  return state === "overdue" ? b("red", spec.icon) : spec;
}

// ------------------------------------------------------------- notifications
/**
 * G26: `AppNotification.Type` strings live in the `sp_Notify*` procedures
 * (task_assigned, ticket_escalated, comment_added, reply, workspace_*…), so
 * the mapping is by substring, most specific first.
 */
export function notificationBadge(type: string | null | undefined): BadgeSpec {
  // Whole words of the snake_case type, so "dismissed" is not "miss".
  const words = new Set((type ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean));
  const has = (...w: string[]) => w.some((x) => words.has(x));
  if (has("escalated", "escalation", "escalate")) return b("lilac", ChevronsUp);
  if (has("breach", "breached", "miss", "missed")) return b("red", OctagonAlert);
  if (has("warn", "warning", "due", "overdue")) return b("butter", Timer);
  // Before "added": comment_added is a comment, not a membership.
  if (has("comment", "reply", "replied")) return b("teal", MessageSquare);
  if (has("workspace", "added", "invite", "invited")) return b("indigo", UserPlus);
  if (has("assign", "assigned")) return b("indigo", UserCheck);
  return b("slate", Bell);
}

// -------------------------------------------------------- complaint activity
const ACTIVITY: Record<string, BadgeSpec> = {
  escalated: b("lilac", ChevronsUp),
  call: b("sky", PhoneCall),
  assigned: b("teal", UserCheck),
  transferred: b("teal", UserCheck),
  created: b("slate", Plus),
  resolved: b("green", CircleCheck),
  onhold: b("butter", CirclePause),
  status: b("butter", CirclePause),
  reopened: b("sky", CircleDot),
  closed: b("slate", Archive),
  rejected: b("red", CircleX),
};
export const activityBadge = (type: string | null | undefined): BadgeSpec =>
  ACTIVITY[(type ?? "").toLowerCase()] ?? b("slate", Pencil);

// -------------------------------------------------------------- TAT timeline
const TAT_EVENT = {
  started: b("sky", CirclePlay),
  held: b("butter", CirclePause),
  due: b("slate", Clock),
  breached: b("red", OctagonAlert),
} as const;
export const tatEventBadge = (event: keyof typeof TAT_EVENT): BadgeSpec => TAT_EVENT[event];

/** Icons E pairs with chips that are not statuses (due date, TAT, Custom). */
export const chipIcons = { date: Calendar, timer: Timer, lock: Lock } as const;
