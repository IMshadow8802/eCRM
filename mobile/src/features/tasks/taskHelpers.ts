import type {
  Task,
  TaskAssignee,
  TaskPriority,
  WorkspaceRole,
} from "../../types/api";

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

// ---------------------------------------------------------------- priority

export const PRIORITY_TONE: Record<TaskPriority, "success" | "warning" | "danger"> = {
  low: "success",
  medium: "warning",
  high: "danger",
  urgent: "danger",
};

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
 * What the current user may do to a task, mirroring sp_CheckTaskPermission.
 * This is a UI convenience ONLY — the server re-checks every mutation, so a
 * wrong answer here hides a button, it never grants access.
 *
 * The split is deliberate and matches the web:
 *   change_status      progress   — ticking checklist, moving column
 *   manage_checklist   artifacts  — adding/removing checklist items
 *   manage_attachments artifacts  — adding/removing files
 *   edit_fields        definition — title, description, due date, assignees
 *
 * Assignment is an act of delegation: being assigned grants progress and
 * artifact rights even to someone who is only a `member` of the workspace,
 * because they cannot do the work otherwise. A `viewer` who is assigned may
 * still record progress but may not reshape the work.
 */
export interface TaskAbilities {
  changeStatus: boolean;
  manageArtifacts: boolean;
  editFields: boolean;
  comment: boolean;
}

export function abilitiesFor(
  task: Task | null | undefined,
  userId: number | null,
  role: WorkspaceRole | null,
  isAdmin = false,
): TaskAbilities {
  if (!task || userId == null) {
    return { changeStatus: false, manageArtifacts: false, editFields: false, comment: false };
  }

  const owner = role === "owner" || role === "manager";
  const creator = task.CreatedByUserId === userId;
  const assigned = isAssignee(task, userId);
  const viewer = role === "viewer";

  // IsAdmin bypasses on shared/project boards only — a personal workspace stays
  // private even from an administrator.
  const adminBypass = isAdmin && task.WorkspaceId != null && role !== null;

  const authority = owner || creator || adminBypass;

  return {
    changeStatus: authority || assigned,
    manageArtifacts: authority || (assigned && !viewer),
    editFields: authority,
    comment: role !== null || creator || assigned,
  };
}
