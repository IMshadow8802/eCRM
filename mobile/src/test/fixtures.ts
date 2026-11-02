// Typed response fixtures. A mocked fetcher's resolved value goes through
// these instead of `as never`, so a fixture that drifts from the fetcher's
// real return type fails `pnpm typecheck`.
import { AxiosError, type AxiosResponse } from "axios";

import type {
  Access,
  ApiEnvelope,
  Customer,
  LoginData,
  Pagination,
  Task,
  Ticket,
  Workspace,
} from "../types/api";

export function envelope<T>(data: T, extra: Partial<ApiEnvelope<T>> = {}): ApiEnvelope<T> {
  return {
    success: true,
    message: "OK",
    responseCode: 200,
    data,
    timestamp: "2026-11-02T00:00:00.000Z",
    ...extra,
  };
}

export const pagination = (totalRecords: number, extra: Partial<Pagination> = {}): Pagination => {
  const pageSize = extra.pageSize ?? 50;
  return {
    currentPage: 1,
    pageSize,
    totalRecords,
    totalPages: Math.max(1, Math.ceil(totalRecords / pageSize)),
    ...extra,
  };
};

/** A sp_FetchTask row with every column present; `patch` sets what a test cares about. */
export const makeTask = (patch: Partial<Task> = {}): Task => ({
  Id: 1,
  Title: "Fix the inverter",
  Description: null,
  WorkspaceId: 10,
  ColumnId: 100,
  ColumnTitle: "To do",
  IsCompleted: false,
  ProjectId: null,
  ParentTaskId: null,
  AssignedToUserId: null,
  CreatedByUserId: 1,
  TeamId: null,
  Priority: null,
  Type: "task",
  DueDate: null,
  EstimatedHours: null,
  LoggedHours: null,
  Progress: null,
  IsBlocked: null,
  Labels: null,
  Watchers: null,
  CompletedDate: null,
  CompletedByUserId: null,
  UpdatedDate: null,
  BranchId: 1,
  ProjectName: null,
  WorkspaceName: "Ops board",
  AssigneeName: null,
  CreatorName: null,
  TeamName: null,
  SubTaskCount: null,
  BlockerCount: null,
  ChecklistTotal: null,
  ChecklistDone: null,
  AssigneesJson: null,
  AssigneeCount: null,
  ...patch,
});

/** AssigneesJson for these people, as sp_FetchTask serialises it. */
export const assigneesJson = (...people: [number, string][]) =>
  JSON.stringify(people.map(([UserId, FullName]) => ({ UserId, FullName, Avatar: null })));

export const makeWorkspace = (patch: Partial<Workspace> = {}): Workspace => ({
  Id: 10,
  Name: "Ops board",
  Type: "shared",
  OwnerUserId: 1,
  TeamId: null,
  ProjectId: null,
  IsArchived: false,
  Color: null,
  Icon: null,
  CompId: 1,
  BranchId: 1,
  CreatedDate: "2026-10-01T10:00:00",
  UpdatedDate: null,
  MyRole: "owner",
  MyInviteStatus: "active",
  MemberCount: 2,
  ...patch,
});

/** Local "YYYY-MM-DD" `offset` days from today — how a SQL `date` arrives. */
export function localDay(offset = 0, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** What axios rejects with when the API refuses: the envelope's message is the reason. */
export const serverError = (status: number, message: string) =>
  new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_REQUEST", undefined, null, {
    status,
    data: envelope(null, { success: false, message, responseCode: status }),
    // ponytail: only `status` and `data` are real; headers/config/request are
    // absent. Add them if code under test ever reads them.
  } as AxiosResponse);

/** A non-admin role with no module grants; `patch` overrides any part. */
export const access = (patch: Partial<Access> = {}): Access => ({
  isAdmin: false,
  canSeeSensitive: false,
  primaryBranchId: 4,
  modules: {},
  ...patch,
});

/** What /api/auth/loginUser answers for Asha (user 9, company 3, branch 4). */
export const loginData = (patch: Partial<LoginData> = {}): LoginData => ({
  token: "tok-1",
  user: {
    Id: 9,
    Username: "asha",
    FullName: "Asha",
    Email: null,
    Mobile: null,
    Avatar: null,
    JobTitle: null,
    HourlyRate: null,
    BranchId: 4,
    CompId: 3,
    IsAdmin: false,
    IsActive: true,
  },
  company: {
    CompId: 3,
    CompName: "Test CRM",
    CompAddress: null,
    CompPhone: null,
    CompState: null,
    CompStateCode: null,
    CompEmail: null,
    CompWebSite: null,
    CompGSTIN: null,
  },
  permissions: { menuItems: [], rawPermissions: [], totalMenuItems: 0, hasAdminAccess: false },
  access: access(),
  ...patch,
});

/** An open, unassigned complaint with every column filled; override what a test reads. */
export const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
  Id: 7,
  CompId: 1,
  BranchId: 1,
  BranchName: "Head Office",
  TicketNo: "T-7",
  Subject: "Inverter keeps tripping",
  CustomerId: 3,
  CustomerName: "Sharma Traders",
  CustomerMobile: "9825012345",
  ContactPerson: null,
  Contact: null,
  ChannelId: null,
  ChannelName: null,
  CategoryId: null,
  CategoryName: null,
  Priority: null,
  PriorityName: null,
  ProductId: null,
  ProductName: null,
  StatusId: 1,
  StatusName: "Open",
  StatusCode: "open",
  AssignedTo: null,
  AssigneeName: null,
  AssigneeAvatar: null,
  AssignedAt: null,
  DueAt: null,
  IsOverdue: false,
  AgeHours: null,
  EscalatedTo: null,
  EscalatedToName: null,
  EscalatedAt: null,
  LinkedLeadId: null,
  ResolvedAt: null,
  ClosedAt: null,
  ResolutionId: null,
  ResolutionName: null,
  Description: null,
  CreatedBy: null,
  CreatedAt: "2026-11-01T10:00:00",
  UpdatedAt: null,
  ...overrides,
});

/** An active customer at office 1 with one open complaint; override what a test reads. */
export const customer = (overrides: Partial<Customer> = {}): Customer => ({
  Id: 3,
  CompId: 1,
  BranchId: 1,
  BranchName: "Head Office",
  Name: "Sharma Traders",
  ContactPerson: "Mr Sharma",
  Mobile: "9825012345",
  AltMobile: null,
  Email: null,
  Address: null,
  City: "Surat",
  State: null,
  Pincode: null,
  Remarks: null,
  IsActive: true,
  OpenTickets: 1,
  TotalTickets: 3,
  LastTicketAt: null,
  CreatedAt: "2026-10-01T00:00:00",
  UpdatedAt: null,
  ...overrides,
});
