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

/** What Central hands back for a company code — see api/centralQueries.ts. */
export interface ClientConfig {
  baseURL: string;
  compCode: string;
  companyName: string | null;
  logoURL: string | null;
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
 * `ticket_status`, `ticket_channel`, `priority`, `resolution`, `call_outcome`,
 * `transfer_reason`, `lead_source`, `lost_reason`.
 *
 * `Code` is the stable key on the kinds that branch on one (`lead_status`,
 * `ticket_status`). Labels are the company's and editable, so nothing in this
 * app matches on `Value`. `TatHours` is meaningful on `priority` only — hours
 * from logging to a complaint's due time; NULL means "no clock".
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
  Code: string | null;
  TatHours?: number | null;
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
 * tblLookup Kind='ticket_status' codes — the ONLY key the lifecycle branches
 * on. Active = open | onhold. Terminal = resolved | closed | rejected.
 */
export type TicketStatusCode = "open" | "onhold" | "resolved" | "closed" | "rejected";

/**
 * A row of sp_FetchTickets RS1 — wider than tblTicket. Since 086 the SP joins
 * every name a screen shows (status, priority, category, channel, product,
 * customer, assignee, escalation target, branch), so a row renders on its own;
 * the lookups are fetched only to fill pickers.
 *
 * `IsOverdue` is computed by the SP (`Code IN ('open','onhold') AND DueAt <
 * GETDATE()`) and never stored. `ResolvedAt` / `ClosedAt` / `ResolutionId` and
 * the reopen `DueAt` are written only by sp_SetTicketStatus — the client never
 * sends them, and `saveTicket` is never used to change a status.
 */
export interface Ticket {
  Id: number;
  CompId: number;
  BranchId: number;
  BranchName: string | null;
  TicketNo: string;
  Subject: string;
  CustomerId: number;
  CustomerName: string | null;
  CustomerMobile: string | null;
  /** "Reported by" — optional, prefilled from the customer on create. */
  ContactPerson: string | null;
  Contact: string | null;
  ChannelId: number | null;
  ChannelName: string | null;
  CategoryId: number | null;
  CategoryName: string | null;
  /** A tblLookup id (Kind = 'priority'). */
  Priority: number | null;
  PriorityName: string | null;
  ProductId: number | null;
  ProductName: string | null;
  StatusId: number;
  StatusName: string | null;
  StatusCode: TicketStatusCode;
  AssignedTo: number | null;
  AssigneeName: string | null;
  AssigneeAvatar: string | null;
  AssignedAt: string | null;
  /** NULL when the priority carries no TAT — such a ticket is never overdue. */
  DueAt: string | null;
  IsOverdue: boolean;
  AgeHours: number | null;
  EscalatedTo: number | null;
  EscalatedToName: string | null;
  EscalatedAt: string | null;
  LinkedLeadId: number | null;
  ResolvedAt: string | null;
  ClosedAt: string | null;
  ResolutionId: number | null;
  ResolutionName: string | null;
  Description: string | null;
  CreatedBy: number | null;
  CreatedAt: string;
  UpdatedAt: string | null;
  /** Detail only — sp_FetchTicketDetail RS1 adds these; the list SP does not. */
  EditBy?: number | null;
  CustomerContactPerson?: string | null;
  CustomerEmail?: string | null;
  CustomerCity?: string | null;
  CustomerAddress?: string | null;
  /** How many other complaints this customer has raised. */
  PreviousTickets?: number | null;
}

/** A row of tblTicketActivity (sp_FetchTicketDetail RS3), author joined. */
export interface TicketActivityEntry {
  Id: number;
  TicketId: number;
  UserId: number | null;
  UserName: string | null;
  UserAvatar: string | null;
  /** created · updated · status · resolved · closed · rejected · reopened · assigned · escalated · call */
  Type: string;
  Summary: string | null;
  MetaJSON: string | null;
  CreatedAt: string;
}

/** A row of tblTicketAssignment (RS4) — one per transfer, names joined. */
export interface TicketAssignment {
  Id: number;
  FromUserId: number | null;
  FromUserName: string | null;
  ToUserId: number | null;
  ToUserName: string | null;
  FromBranchId: number | null;
  FromBranchName: string | null;
  ToBranchId: number | null;
  ToBranchName: string | null;
  ReasonId: number | null;
  Reason: string | null;
  Remarks: string;
  AssignedBy: number | null;
  AssignedByName: string | null;
  AssignedAt: string;
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

/** The lead a ticket was raised from, when there is one (RS5). */
export interface LinkedLead {
  Id: number;
  Name: string | null;
  MobileNo: string | null;
  Email: string | null;
  StatusId: number | null;
}

/** sp_FetchTicketDetail returns five result sets; the controller names them. */
export interface TicketDetail {
  ticket: Ticket | null;
  fields: CustomFieldValue[];
  activity: TicketActivityEntry[];
  assignments: TicketAssignment[];
  linkedLead: LinkedLead | null;
}

/** A row of sp_FetchCustomers RS1 — tblCustomer plus branch name and counts. */
export interface Customer {
  Id: number;
  CompId: number;
  BranchId: number;
  BranchName: string | null;
  /** The business or the person. */
  Name: string;
  ContactPerson: string | null;
  Mobile: string | null;
  AltMobile: string | null;
  Email: string | null;
  Address: string | null;
  City: string | null;
  State: string | null;
  Pincode: string | null;
  Remarks: string | null;
  IsActive: boolean;
  OpenTickets: number;
  TotalTickets: number;
  LastTicketAt: string | null;
  CreatedAt: string;
  UpdatedAt: string | null;
}

/** sp_FetchEscalationTargets — the chain of command above a user, nearest first. */
export interface EscalationTarget {
  Id: number;
  FullName: string;
  JobTitle: string | null;
  BranchId: number | null;
  BranchName: string | null;
  /** 1 = direct manager. */
  Depth: number;
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

/** /api/users/fetchAssignableUsers — who the caller may hand a record to. */
export interface AssignableUser {
  Id: number;
  FullName: string;
  Avatar: string | null;
  JobTitle: string | null;
  BranchId: number | null;
  BranchName: string | null;
  ReportsTo: number | null;
}

/** A row of sp_FetchProducts RS1 (tblProduct + category name). */
export interface Product {
  Id: number;
  CompId: number;
  Name: string;
  Code: string | null;
  CategoryId: number | null;
  CategoryName: string | null;
  UnitPrice: number | null;
  MarginPct: number | null;
  IsActive: boolean;
}
