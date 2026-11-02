import { Calendar, CirclePause, Lock, Timer, type LucideIcon } from "lucide-react-native";

import { fetchTasks } from "../../api/taskQueries";
import { fetchMyDay } from "../../api/todayQueries";
import type { ChipTone } from "../../theme";
import type {
  DayTask,
  MyDay,
  Task,
  TaskAssignee,
  TaskComment,
  TaskPriority,
  WorkspaceRole,
  WorkspaceType,
} from "../../types/api";
import { parseIst } from "./tatChip";

/**
 * One workspace's tasks, as the board shows them. Board, Columns and
 * TaskDetail read the unsearched key, so opening any of them after another
 * costs no request; a search gets its own entry beneath it, and invalidating
 * ["tasks"] reaches all of them.
 */
export function boardQuery(workspaceId: number | null, term = "") {
  return {
    queryKey: term ? ["tasks", "board", workspaceId, term] : ["tasks", "board", workspaceId],
    queryFn: () => fetchTasks({ WorkspaceId: workspaceId, PageSize: 200, SearchTerm: term || null }),
  };
}

/**
 * My open tasks across every workspace — My Work's "Mine" list. Home counts
 * the same query, so the two numbers cannot disagree and share one request.
 */
export function myTasksQuery(userId: number | null) {
  return {
    queryKey: ["tasks", "mine", userId],
    queryFn: () =>
      fetchTasks({ WorkspaceId: null, AssigneeUserId: userId, OnlyOpen: true, PageSize: 200 }),
    enabled: userId != null,
  };
}

/**
 * G10: my tasks finished or not — the Done pill and "Completed this week"
 * (My Work) and Home's "Done this week" read the same entry.
 */
export function myDoneQuery(userId: number | null) {
  return {
    queryKey: ["tasks", "mine", "with-done", userId],
    queryFn: () =>
      fetchTasks({ WorkspaceId: null, AssigneeUserId: userId, OnlyOpen: false, PageSize: 200 }),
    enabled: userId != null,
  };
}

/** Monday 00:00, local. */
export function weekStart(now = new Date()): Date {
  const back = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
}

/** Completed on or after this Monday (G10). */
export const doneThisWeek = (tasks: Task[], now = new Date()): Task[] => {
  const from = weekStart(now).getTime();
  return tasks.filter((t) => t.IsCompleted && t.CompletedDate != null && new Date(t.CompletedDate).getTime() >= from);
};

/** "42 m" · "3 h" · "2 d" — E's short spans ("Due in 3 h", "Overdue 21 h"). */
export function shortSpan(ms: number): string {
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins} m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} h`;
  return `${Math.floor(hrs / 24)} d`;
}

/** "Fri, 6 Nov" from a SQL date (local calendar day, never UTC). */
export function shortDay(date: string | null | undefined): string {
  const [y, m, d] = (date ?? "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const day = new Date(y, m - 1, d);
  const wd = day.toLocaleDateString("en-IN", { weekday: "short" });
  const dm = day.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${wd}, ${dm}`;
}

export interface DueChip {
  label: string;
  tone: ChipTone;
  icon: LucideIcon;
}

/**
 * The third line of a task row (E 05): slate lock "Personal" (G9), butter
 * timer "Due in 3 h" / red "Missed" on an open clock, "On hold" on a held one,
 * else the due date (red once past). Nothing for a finished task.
 */
export function taskDueChip(task: Task, personal: boolean, now = new Date()): DueChip | null {
  if (personal) return { label: "Personal", tone: "slate", icon: Lock };
  if (task.IsCompleted) return null;
  if (task.TatHeldSince) return { label: "On hold", tone: "slate", icon: CirclePause };
  const due = parseIst(task.TatDueAt);
  if (due) {
    return due < now
      ? { label: "Missed", tone: "red", icon: Timer }
      : { label: `Due in ${shortSpan(due.getTime() - now.getTime())}`, tone: "butter", icon: Timer };
  }
  if (!task.DueDate) return null;
  return { label: shortDay(task.DueDate), tone: dueBucket(task.DueDate, now) === "overdue" ? "red" : "slate", icon: Calendar };
}

/** TAT-06: the server's Today flags. ["tasks"] prefix so task writes refresh it. */
export const MY_DAY_QUERY = { queryKey: ["tasks", "today", "mine"], queryFn: fetchMyDay };

/** 0 = a reason owed, 1 = overdue, 2 = close to its deadline. */
export const needRank = (t: DayTask) => (t.flags.reasonOwed ? 0 : t.flags.overdue ? 1 : 2);

/**
 * My Work's "Needs you": most urgent first, as on the web's My Day — a reason
 * owed, then overdue, then close to the deadline; least time left first within
 * each. Nothing before go-live.
 */
export function needsYou(day: MyDay | null | undefined): DayTask[] {
  if (!day?.day.live) return [];
  return (day.me?.tasks ?? [])
    .filter((t) => t.flags.reasonOwed || t.flags.overdue || t.flags.atRisk)
    .sort(
      (a, b) =>
        needRank(a) - needRank(b) || (a.timeLeftMin ?? Infinity) - (b.timeLeftMin ?? Infinity),
    );
}

/**
 * Assignment lives in tblTaskAssignee and arrives as AssigneesJson. The scalar
 * `AssignedToUserId` on the task is a NON-AUTHORITATIVE mirror of the first
 * assignee only — reading it drops every co-assignee, which is exactly the bug
 * that made "only one person can tick the checklist" on the web.
 *
 * Falls back to the mirror solely for rows written before tblTaskAssignee
 * existed, where AssigneesJson is null but the scalar is set.
 */
export function assigneesOf(task: Pick<Task, "AssigneesJson" | "AssignedToUserId" | "AssigneeName">): TaskAssignee[] {
  if (task.AssigneesJson) {
    try {
      const parsed = JSON.parse(task.AssigneesJson);
      if (Array.isArray(parsed)) return parsed as TaskAssignee[];
    } catch {
      // Malformed JSON must not blank the whole list — fall through to the mirror.
    }
  }
  if (task.AssignedToUserId) {
    return [
      {
        UserId: task.AssignedToUserId,
        FullName: task.AssigneeName ?? "",
        Avatar: null,
      },
    ];
  }
  return [];
}

export const isAssignee = (task: Task, userId: number | null): boolean =>
  userId != null && assigneesOf(task).some((a) => a.UserId === userId);

export const isUnassigned = (task: Task): boolean => assigneesOf(task).length === 0;

// ---------------------------------------------------------------- due dates

export type DueBucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "later"
  | "noDate";

export const BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  thisWeek: "This week",
  later: "Later",
  noDate: "No due date",
};

/** Order the sections appear in. Overdue first — that is the whole point. */
export const BUCKET_ORDER: DueBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "thisWeek",
  "later",
  "noDate",
];

/**
 * Compares LOCAL calendar days, never timestamps. `DueDate` is a SQL `date`
 * with no timezone; parsing it as UTC and comparing against `new Date()` makes
 * everything due today look overdue for anyone east of Greenwich — which is
 * every user of this app.
 */
export function dueBucket(dueDate: string | null, now = new Date()): DueBucket {
  if (!dueDate) return "noDate";

  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "noDate";

  const due = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return "thisWeek";
  return "later";
}

/** "Due 3 Aug" / "2 days overdue" — the phrasing a card needs. */
export function dueLabel(dueDate: string | null, now = new Date()): string | null {
  if (!dueDate) return null;
  const bucket = dueBucket(dueDate, now);
  if (bucket === "today") return "Due today";
  if (bucket === "tomorrow") return "Due tomorrow";

  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d);

  if (bucket === "overdue") {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((today.getTime() - due.getTime()) / 86_400_000);
    return days === 1 ? "1 day overdue" : `${days} days overdue`;
  }

  return `Due ${due.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}

/**
 * "4m ago" / "3d ago" / "12 Jul" for a timestamp column.
 *
 * These are `datetime` values, not `date`: the backend runs with
 * `useUTC: false` and the container is pinned to Asia/Kolkata, so a serialised
 * timestamp is a correct instant and plain `new Date()` parsing is right here.
 * Only `DueDate` needs the local-calendar treatment above.
 */
export function relativeTime(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const mins = Math.round((now.getTime() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(then).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/** "4h" / "1.5h" — hours are decimals in the DB and 1.5 must not print as 2. */
export const formatHours = (h: number) =>
  `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

// ---------------------------------------------------------------- priority

const PRIORITY_TONE: Record<TaskPriority, ChipTone> = {
  low: "success",
  medium: "warning",
  high: "danger",
  urgent: "urgent",
};

/** The chip tone for a task's own four-level priority (same scale TaskCard inks). */
export const taskPriorityTone = (p: TaskPriority): ChipTone => PRIORITY_TONE[p];

/** Checklist drives completion — there is no IsDone column to read. */
export function checklistProgress(task: Task): { done: number; total: number } {
  return { done: task.ChecklistDone ?? 0, total: task.ChecklistTotal ?? 0 };
}

/** Group tasks into due-date sections, preserving the server's order within each. */
export function groupByDue(
  tasks: Task[],
  now = new Date(),
): { bucket: DueBucket; tasks: Task[] }[] {
  const buckets = new Map<DueBucket, Task[]>();
  for (const task of tasks) {
    const key = dueBucket(task.DueDate, now);
    const list = buckets.get(key);
    if (list) list.push(task);
    else buckets.set(key, [task]);
  }
  return BUCKET_ORDER.filter((b) => buckets.get(b)?.length).map((bucket) => ({
    bucket,
    tasks: buckets.get(bucket)!,
  }));
}

// ------------------------------------------------------------- permissions

/**
 * What the current user may do on a board / to a task, mirroring
 * sp_CheckTaskPermission. UI convenience ONLY — the server re-checks every
 * mutation, so a wrong answer hides a button, it never grants access.
 * Matches web/src/utils/taskAbilities.js — change both together.
 *
 * Order is the SP's: personal -> owner only (admins are out too); admin ->
 * everything on shared/project; else the ACTIVE member role decides.
 */
export interface WorkspaceAbilities {
  full: boolean;
  member: boolean;
  viewer: boolean;
  view: boolean;
  createTask: boolean;
  manageColumns: boolean;
  pinComment: boolean;
}

export function workspaceAbilities(
  role: WorkspaceRole | null,
  isAdmin: boolean,
  wsType: WorkspaceType | null,
): WorkspaceAbilities {
  const personal = wsType === "personal";
  const full = personal
    ? role === "owner"
    : Boolean(isAdmin && wsType) || role === "owner" || role === "manager";
  const member = !personal && !full && role === "member";
  const viewer = !personal && !full && role === "viewer";
  return {
    full,
    member,
    viewer,
    view: full || member || viewer,
    createTask: full || member,
    manageColumns: full,
    pinComment: full,
  };
}

export interface TaskAbilities extends WorkspaceAbilities {
  comment: boolean;
  changeStatus: boolean;
  logTime: boolean;
  manageArtifacts: boolean;
  editFields: boolean;
  claim: boolean;
  deleteTask: boolean;
}

export function abilitiesFor(
  task: Task | null | undefined,
  userId: number | null,
  role: WorkspaceRole | null,
  isAdmin: boolean,
  wsType: WorkspaceType | null,
): TaskAbilities {
  const ws = workspaceAbilities(role, isAdmin, wsType);
  const creator = task != null && userId != null && Number(task.CreatedByUserId) === Number(userId);
  const assigned = task != null && isAssignee(task, userId);
  const others = task
    ? assigneesOf(task).some((a) => Number(a.UserId) !== Number(userId))
    : false;
  const progress = ws.full || (ws.member && (assigned || creator)) || (ws.viewer && assigned);
  return {
    ...ws,
    comment: ws.view,
    changeStatus: progress,
    logTime: progress,
    manageArtifacts: ws.full || (ws.member && (assigned || creator)),
    editFields: ws.full || (ws.member && creator),
    // An actual membership role, never the admin bypass: sp_ClaimTask 400s a
    // non-member ("Only a member of this board can take its tasks").
    claim: (role === "owner" || role === "manager" || role === "member") && (ws.full || ws.member)
      && task != null && assigneesOf(task).length === 0,
    // the server also refuses when someone else has commented - it has the last word
    deleteTask: task != null && (ws.full || (ws.member && creator && !others)),
  };
}

/**
 * The comment list as a thread: each top-level comment (in the server's order,
 * pinned first) followed by every reply under it, a reply to a reply included.
 * One level of indent, like the web; deeper nesting does not fit a phone.
 * A reply whose parent is not in the list stands as a top-level comment. A
 * pinned reply stays at the top where the server put it, still indented —
 * the web does the same, and a pin that hid it inside a thread would be no pin.
 */
export function threadComments(
  comments: TaskComment[],
): { comment: TaskComment; reply: boolean }[] {
  const byId = new Map(comments.map((c) => [c.Id, c]));
  const rootOf = (c: TaskComment) => {
    let at = c;
    const seen = new Set<number>();
    // `seen` stops a parent loop in bad data from spinning forever.
    while (at.ParentCommentId != null && byId.has(at.ParentCommentId) && !seen.has(at.Id)) {
      seen.add(at.Id);
      at = byId.get(at.ParentCommentId)!;
    }
    return at.Id;
  };
  const top: { comment: TaskComment; reply: boolean }[] = [];
  const replies = new Map<number, TaskComment[]>();
  for (const c of comments) {
    const root = rootOf(c);
    if (root === c.Id) top.push({ comment: c, reply: false });
    else if (c.IsPinned) top.push({ comment: c, reply: true });
    else replies.set(root, [...(replies.get(root) ?? []), c]);
  }
  return top.flatMap((row) => [
    row,
    ...(row.reply ? [] : replies.get(row.comment.Id) ?? []).map((comment) => ({ comment, reply: true })),
  ]);
}
