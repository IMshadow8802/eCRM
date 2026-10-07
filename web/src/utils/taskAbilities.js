// Mirror of sp_CheckTaskPermission (+ the kanban SPs' column gate). UI only:
// a wrong answer hides a button, it never grants access - the server re-checks.
// Keep in step with mobile/src/features/tasks/taskHelpers.ts (change both together).
// Order is the SP's: personal -> owner only (admins are out too);
// admin -> everything on shared/project; else the ACTIVE member role decides.
//
// Exports:
//   workspaceAbilities({ wsType, role, isAdmin })
//     -> { full, member, viewer, view, createTask, manageColumns, pinComment }
//   taskAbilities({ wsType, role, isAdmin, userId, task })
//     -> workspaceAbilities + { comment, changeStatus, logTime, manageArtifacts,
//                               editFields, claim, deleteTask }
import { assigneesOf, isAssignee } from "./taskAssignees";

export function workspaceAbilities({ wsType, role, isAdmin }) {
  const personal = wsType === "personal";
  // ponytail: personal owner is read from role === "owner" - every personal
  // workspace has its owner's member row; OwnerUserId is not in the store.
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

export function taskAbilities({ wsType, role, isAdmin, userId, task }) {
  const ws = workspaceAbilities({ wsType, role, isAdmin });
  const creator = task != null && Number(task.CreatedByUserId) === Number(userId);
  const assigned = task != null && isAssignee(task, userId);
  const others = task ? assigneesOf(task).some((a) => Number(a.UserId) !== Number(userId)) : false;
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
