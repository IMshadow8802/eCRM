// src/types/api.ts
//
// Hand-written from the live schema and the stored procedures — not guessed.
// Entity fields come from INFORMATION_SCHEMA; the extra columns on Task
// (ColumnTitle, ChecklistTotal, AssigneesJson, …) come from sp_FetchTask's
// SELECT list, which returns more than tblTasks holds.
//
// These types are a COPY of the backend contract, not a shared source of
// truth. If a controller or SP changes shape, this file must change with it —
// nothing enforces that automatically. Keeping every fetcher in src/api/ is
// what makes that a single-file edit rather than a hunt.
//
// SQL -> TS mapping used throughout:
//   bit               -> boolean   (mssql returns true/false, not 1/0)
//   date / datetime   -> string    (ISO, serialised by JSON)
//   decimal           -> number
//   NULLable column   -> `| null`

// ---------------------------------------------------------------- envelope

/** Every endpoint answers with this shape. See backend/src/utils/responseHelper.js */
export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message: string;
  responseCode: number;
  data: T | null;
  timestamp: string;
  code?: string;
}

export interface Pagination {
  currentPage: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
}

// ------------------------------------------------------------------ enums

export type WorkspaceType = "personal" | "shared" | "project";

/** tblWorkspaceMembers.Role — task authority derives from this. */
export type WorkspaceRole = "owner" | "manager" | "member" | "viewer";

/** Pending and declined are NOT members. Filter before offering as assignee. */
export type InviteStatus = "active" | "pending" | "declined";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type AttachmentEntity = "task" | "ticket" | "lead";

/** The config engine's discriminator. One set of tables serves both modules. */
export type ConfigEntity = "lead" | "ticket";

/**
 * A stage's role in the lifecycle. `open` is in-flight; `won` is a successful
 * end; `lost` is a rejection. Support reads them as Open → Resolved → Closed
 * and Rejected — see ticketHelpers for how the two `won` stages are told apart.
 */
export type StageType = "open" | "won" | "lost";

export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "dropdown"
  | "checkbox";

// ------------------------------------------------------------------- auth

export interface AuthUser {
  Id: number;
  Username: string;
  FullName: string;
  Email: string | null;
  Mobile: string | null;
  Avatar: string | null;
  JobTitle: string | null;
  HourlyRate: number | null;
  BranchId: number;
  CompId: number;
  IsAdmin: boolean;
  IsActive: boolean;
}

export interface Company {
  CompId: number;
  CompName: string;
  CompAddress: string | null;
  CompPhone: string | null;
  CompState: string | null;
  CompStateCode: string | null;
  CompEmail: string | null;
  CompWebSite: string | null;
  CompGSTIN: string | null;
}

/**
 * A menu-rights row. NOTE the lower-case keys: authController.mapMenuRow
 * rewrites the SP's PascalCase columns into this shape, so this is the only
 * payload in the API that is not PascalCase. Do not "correct" it.
 */
export interface MenuItem {
  menuid: number;
  parentid: number;
  description: string;
  image: string | null;
  route: string | null;
  formname: string | null;
  formclass: string | null;
  openStyle: number | null;
  permissions: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };
  groupName: string | null;
  children?: MenuItem[];
}

export interface Permissions {
  menuItems: MenuItem[];
  rawPermissions: MenuItem[];
  totalMenuItems: number;
  hasAdminAccess: boolean;
}

export interface LoginData {
  token: string;
  user: AuthUser;
  company: Company;
  permissions: Permissions;
}

// ------------------------------------------------------------------- task

/** One entry of Task.AssigneesJson once parsed. */
export interface TaskAssignee {
  UserId: number;
  FullName: string;
  Avatar: string | null;
}

/**
 * A row from sp_FetchTask. Wider than tblTasks — the SP joins names and
 * aggregates counts.
 *
 * Completion is derived from the checklist; there is no IsDone column and one
 * must never be reintroduced. `IsCompleted` is computed, not stored intent.
 *
 * `AssignedToUserId` is a NON-AUTHORITATIVE mirror of the first assignee, kept
 * only so the SP can LEFT JOIN one user row per task. Never read it to decide
 * who is assigned — parse `AssigneesJson`, or a co-assignee silently vanishes.
 */
export interface Task {
  Id: number;
  Title: string;
  Description: string | null;
  WorkspaceId: number | null;
  ColumnId: number | null;
  ColumnTitle: string | null;
  IsCompleted: boolean;
  ProjectId: number | null;
  ParentTaskId: number | null;
  AssignedToUserId: number | null;
  CreatedByUserId: number;
  TeamId: number | null;
  Priority: TaskPriority | null;
  Type: string | null;
  DueDate: string | null;
  EstimatedHours: number | null;
  LoggedHours: number | null;
  Progress: number | null;
  IsBlocked: boolean | null;
  Labels: string | null;
  Watchers: string | null;
  CompletedDate: string | null;
  CompletedByUserId: number | null;
  UpdatedDate: string | null;
  BranchId: number | null;
  ProjectName: string | null;
  WorkspaceName: string | null;
  AssigneeName: string | null;
  CreatorName: string | null;
  TeamName: string | null;
  SubTaskCount: number | null;
  BlockerCount: number | null;
  ChecklistTotal: number | null;
  ChecklistDone: number | null;
  /** JSON array of TaskAssignee. Null when the task has no assignees. */
  AssigneesJson: string | null;
  AssigneeCount: number | null;
}

export interface TaskChecklistItem {
  Id: number;
  TaskId: number;
  ItemText: string;
  IsCompleted: boolean;
  SortOrder: number | null;
}

export interface TaskComment {
  Id: number;
  TaskId: number;
  Comment: string;
  UserId: number;
  UserName: string | null;
  Avatar: string | null;
  ParentCommentId: number | null;
  IsPinned: boolean | null;
  CreatedDate: string;
  UpdatedDate: string | null;
}

export interface TaskTimeEntry {
  Id: number;
  TaskId: number;
  TaskTitle: string | null;
  UserId: number;
  UserName: string | null;
  Hours: number;
  Description: string | null;
  WorkDate: string | null;
  CreatedDate: string;
}

/** A row of tblActivityLog, as returned by sp_FetchTaskActivity. */
export interface TaskActivityEntry {
  Id: number;
  TaskId: number;
  UserId: number | null;
  UserName: string | null;
  Action: string;
  OldValue: string | null;
  NewValue: string | null;
  Description: string | null;
  CreatedDate: string;
}

/**
 * One end of a dependency edge, as returned by sp_FetchTaskDependencies.
 *
 * `TaskId` here is the OTHER task — the blocker's id in a `blockers` row, the
 * dependent's id in a `dependents` row. The task you asked about is not
 * repeated on the row.
 */
export interface TaskDependency {
  Direction: "blocker" | "dependent";
  TaskId: number;
  Title: string | null;
  ColumnTitle: string | null;
  IsCompleted: boolean;
  Type: string;
}

// -------------------------------------------------------------- workspace

export interface Workspace {
  Id: number;
  Name: string;
  Type: WorkspaceType;
  OwnerUserId: number;
  TeamId: number | null;
  ProjectId: number | null;
  IsArchived: boolean;
  Color: string | null;
  Icon: string | null;
  CompId: number;
  BranchId: number;
  CreatedDate: string;
  UpdatedDate: string | null;
  /** The caller's own role in this workspace, resolved by sp_FetchWorkspaces. */
  MyRole: WorkspaceRole | null;
  MyInviteStatus: InviteStatus | null;
  MemberCount: number | null;
}

// NOTE: sp_FetchWorkspaces returns exactly the columns above. It does NOT
// return a task count or the owner's name — do not add them here without
// adding them to the procedure first.

export interface WorkspaceMember {
  Id: number;
  WorkspaceId: number;
  UserId: number;
  Role: WorkspaceRole;
  AddedByUserId: number | null;
  JoinedDate: string;
  IsActive: boolean;
  InviteStatus: InviteStatus;
  InvitedDate: string | null;
  RespondedDate: string | null;
  FullName: string | null;
  Username: string | null;
  Avatar: string | null;
  Email: string | null;
}

export interface KanbanColumn {
  Id: number;
  WorkspaceId: number | null;
  Title: string;
  Color: string | null;
  SortOrder: number | null;
  MaxTasks: number | null;
  IsActive: boolean | null;
  CompId: number;
  BranchId: number;
  CreatedDate: string | null;
  IsCompanyWide: boolean;
}

// ---------------------------------------------------------- config engine

/**
 * A row of tblLookup. `Kind` is the list it belongs to — `ticket_category`,
 * `priority`, `resolution`, `call_outcome`, `lead_source`, `lost_reason`.
 *
 * Note that a ticket's Priority is a lookup **Id**, not the string enum tasks
 * use. The two modules genuinely differ here; do not unify them.
 */
export interface Lookup {
  Id: number;
  CompId: number;
  Kind: string;
  Value: string;
  SortOrder: number | null;
  IsActive: boolean;
}

export interface Pipeline {
  Id: number;
  CompId: number;
  Entity: ConfigEntity;
  Name: string;
  IsDefault: boolean;
  IsActive: boolean;
  CreatedAt: string;
}

export interface PipelineStage {
  Id: number;
  CompId: number;
  PipelineId: number;
  Name: string;
  SortOrder: number;
  StageType: StageType;
  /** Hex from the DB, drawn straight onto the stage chip. */
  Color: string | null;
  IsActive: boolean;
}

/**
 * A typed-EAV field definition. `Options` is a JSON string for `dropdown`
 * fields — either `["a","b"]` or `[{"value":"a","label":"A"}]`, both seen in
 * the wild, so parse defensively.
 */
export interface CustomFieldDef {
  Id: number;
  CompId: number;
  Entity: ConfigEntity;
  FieldKey: string;
  Label: string;
  Type: CustomFieldType;
  Options: string | null;
  IsRequired: boolean;
  SortOrder: number | null;
  IsActive: boolean;
  CreatedBy: number | null;
  CreatedAt: string | null;
}

/** A stored value, as returned inside sp_FetchTicketDetail's second result set. */
export interface CustomFieldValue {
  FieldId: number;
  FieldKey: string;
  Label: string;
  Type: CustomFieldType;
  ValueText: string | null;
  ValueNumber: number | null;
  ValueDate: string | null;
}

// ----------------------------------------------------------------- ticket

/**
 * A row of tblTicket, as returned by sp_FetchTickets and sp_FetchTicketDetail.
 *
 * NOTE what is absent: the SP joins nothing. There is no StageName,
 * CategoryName, PriorityName or AssigneeName — every one of those is an id
 * that the client resolves against the lookups and stages it fetched
 * separately. The web does the same. Do not add them here without adding the
 * joins to the procedure first.
 *
 * `Priority` and `CategoryId` are tblLookup ids. `ResolvedAt`/`ClosedAt`/
 * `ResolutionId` are stamped by sp_MoveTicketStage and must never be written
 * directly — stage is the single source of truth for the lifecycle.
 */
export interface Ticket {
  Id: number;
  CompId: number;
  BranchId: number;
  TicketNo: string;
  CustomerName: string | null;
  ContactPerson: string | null;
  Contact: string | null;
  Channel: string | null;
  CategoryId: number | null;
  Priority: number | null;
  PipelineId: number | null;
  StageId: number | null;
  AssignedTo: number | null;
  LinkedLeadId: number | null;
  ResolvedAt: string | null;
  ClosedAt: string | null;
  ResolutionId: number | null;
  Description: string | null;
  CreatedAt: string;
  UpdatedAt: string | null;
  /** Detail only — the list SP does not select these. */
  CreatedBy?: number | null;
  EditBy?: number | null;
}

/** A row of tblTicketActivity. `MetaJSON` carries per-type detail. */
export interface TicketActivityEntry {
  Id: number;
  TicketId: number;
  UserId: number | null;
  Type: string;
  Summary: string | null;
  MetaJSON: string | null;
  CreatedAt: string;
}

/**
 * A row of tblCall. Exactly one of LeadId / TicketId is set.
 *
 * `Direction` is the SP's own two-value vocabulary — 'in' or 'out'. It rejects
 * anything else, so do not send "Inbound".
 */
export interface Call {
  Id: number;
  CompId: number;
  LeadId: number | null;
  TicketId: number | null;
  UserId: number;
  Direction: "in" | "out";
  OutcomeId: number | null;
  Notes: string | null;
  /** Minutes. */
  Duration: number | null;
  CalledAt: string;
  CreatedBy: number | null;
  CreatedAt: string;
}

/** The lead a ticket was raised from, when there is one. */
export interface LinkedLead {
  Id: number;
  Name: string | null;
  MobileNo: string | null;
  Email: string | null;
  StageId: number | null;
}

/** sp_FetchTicketDetail returns four result sets; the controller names them. */
export interface TicketDetail {
  ticket: Ticket | null;
  fields: CustomFieldValue[];
  activity: TicketActivityEntry[];
  linkedLead: LinkedLead | null;
}

// ------------------------------------------------------- misc collections

export interface Attachment {
  Id: number;
  Entity: AttachmentEntity;
  EntityId: number;
  FileName: string;
  StoredName: string;
  FileSize: number;
  MimeType: string | null;
  UploadedBy: number;
  UploaderName: string | null;
  CreatedDate: string;
}

export interface Notification {
  Id: number;
  UserId: number;
  Title: string;
  Message: string | null;
  Type: string | null;
  IsRead: boolean;
  EntityType: string | null;
  EntityId: number | null;
  CreatedDate: string;
}

/** /api/users/directory — the non-admin-safe name lookup. */
export interface DirectoryUser {
  Id: number;
  FullName: string;
  Username: string | null;
  Avatar: string | null;
  JobTitle: string | null;
}
