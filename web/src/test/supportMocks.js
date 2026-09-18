// MSW handlers + fixtures for the Support / complaints screens (spec 2). One
// place for the pick-lists every ticket screen loads on mount, the ticket and
// customer endpoints, and a row factory per entity. `cap.<name>` receives the
// last posted body so a test can assert what the page asked for.
import { http, HttpResponse } from "msw";

import { server } from "./mocks/server";

export const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
export const refuse = (message, status = 400) =>
  HttpResponse.json({ success: false, message, responseCode: status }, { status });

const page = (rows) => ({ currentPage: 1, pageSize: 25, totalRecords: rows.length, totalPages: 1 });

// Ids are fixtures, not live ids — 086 creates the real ticket_status rows.
export const LOOKUPS = {
  ticket_status: [
    { Id: 61, Kind: "ticket_status", Value: "New", Code: "open", SortOrder: 1 },
    { Id: 62, Kind: "ticket_status", Value: "In Progress", Code: "open", SortOrder: 2 },
    { Id: 63, Kind: "ticket_status", Value: "On Hold", Code: "onhold", SortOrder: 3 },
    { Id: 64, Kind: "ticket_status", Value: "Resolved", Code: "resolved", SortOrder: 4 },
    { Id: 65, Kind: "ticket_status", Value: "Closed", Code: "closed", SortOrder: 5 },
    { Id: 66, Kind: "ticket_status", Value: "Rejected", Code: "rejected", SortOrder: 6 },
  ],
  priority: [
    { Id: 1, Kind: "priority", Value: "Low", SortOrder: 1, TatHours: 168 },
    { Id: 3, Kind: "priority", Value: "High", SortOrder: 3, TatHours: 24 },
  ],
  ticket_category: [{ Id: 5, Value: "General" }, { Id: 6, Value: "Billing" }],
  ticket_channel: [{ Id: 71, Value: "Phone" }, { Id: 72, Value: "WhatsApp" }],
  resolution: [{ Id: 8, Value: "Fixed" }, { Id: 9, Value: "Won't Fix" }],
  transfer_reason: [{ Id: 36, Value: "Absent" }, { Id: 38, Value: "Wrong branch" }],
  call_outcome: [{ Id: 50, Value: "Answered" }],
};
export const USERS = [
  { Id: 17, Username: "se_ho_amit", FullName: "Amit Singh", BranchId: 1, BranchName: "HEAD OFFICE" },
  { Id: 18, Username: "se_ho_sara", FullName: "Sara Khan", BranchId: 1, BranchName: "HEAD OFFICE" },
];
export const BRANCHES = [{ Id: 1, BranchName: "HEAD OFFICE" }, { Id: 2, BranchName: "SOUTH EXTENSION" }];
export const PRODUCTS = [{ Id: 1, Name: "Gold Chain 22K" }];
export const SENIORS = [
  { Id: 16, FullName: "Neha Verma", JobTitle: "Team Lead", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 1 },
  { Id: 15, FullName: "Rahul Mehta", JobTitle: "Branch Manager", BranchId: 1, BranchName: "HEAD OFFICE", Depth: 2 },
];

export const ticketRow = (over = {}) => ({
  Id: 7, CompId: 1, BranchId: 1, BranchName: "HEAD OFFICE", TicketNo: "TKT-0007", Subject: "Screen flickers on boot",
  CustomerId: 3, CustomerName: "Acme Corp", CustomerMobile: "9990001111", ContactPerson: "Gurpreet", Contact: "9990001111",
  ChannelId: 71, ChannelName: "Phone", CategoryId: 6, CategoryName: "Billing", Priority: 3, PriorityName: "High",
  ProductId: null, ProductName: null, StatusId: 62, StatusName: "In Progress", StatusCode: "open",
  AssignedTo: 17, AssigneeName: "Amit Singh", AssigneeAvatar: null, AssignedAt: "2026-09-15T10:00:00Z",
  DueAt: "2026-09-16T10:00:00Z", IsOverdue: 0, AgeHours: 5, EscalatedTo: null, EscalatedToName: null, EscalatedAt: null,
  LinkedLeadId: null, ResolvedAt: null, ClosedAt: null, ResolutionId: null, ResolutionName: null,
  Description: "Flickers for a minute after power-on.", CreatedBy: 17, CreatedAt: "2026-09-15T10:00:00Z", UpdatedAt: null,
  ...over,
});

export const customerRow = (over = {}) => ({
  Id: 3, CompId: 1, BranchId: 1, BranchName: "HEAD OFFICE", Name: "Acme Corp", ContactPerson: "Gurpreet",
  Mobile: "9990001111", AltMobile: null, Email: "acme@example.com", Address: "12 MG Road", City: "Pune", State: "MH",
  Pincode: "411001", Remarks: null, IsActive: 1, OpenTickets: 1, TotalTickets: 3, LastTicketAt: "2026-09-15T10:00:00Z",
  CreatedAt: "2026-08-01T10:00:00Z", UpdatedAt: null,
  ...over,
});

export const ticketDetail = (over = {}) => ({
  ticket: ticketRow({
    EditBy: null, CustomerContactPerson: "Gurpreet", CustomerEmail: "acme@example.com",
    CustomerCity: "Pune", CustomerAddress: "12 MG Road", PreviousTickets: 2,
  }),
  fields: [],
  activity: [
    { Id: 1, TicketId: 7, UserId: 17, UserName: "Amit Singh", UserAvatar: null, Type: "created", Summary: "Complaint created", MetaJSON: null, CreatedAt: "2026-09-15T10:00:00Z" },
    { Id: 2, TicketId: 7, UserId: 17, UserName: "Amit Singh", UserAvatar: null, Type: "status", Summary: "Status: New → In Progress", MetaJSON: null, CreatedAt: "2026-09-15T11:00:00Z" },
  ],
  assignments: [
    { Id: 31, FromUserId: null, FromUserName: null, ToUserId: 17, ToUserName: "Amit Singh", FromBranchId: 1, FromBranchName: "HEAD OFFICE", ToBranchId: 1, ToBranchName: "HEAD OFFICE", ReasonId: null, Reason: null, Remarks: "Assigned on creation", AssignedBy: 17, AssignedByName: "Amit Singh", AssignedAt: "2026-09-15T10:00:00Z" },
  ],
  linkedLead: null,
  ...over,
});

/** The pick-lists every ticket screen loads on mount, keyed by Kind. */
export function mockSupportRefData() {
  server.use(
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const { Kind } = await request.json();
      return json({ lookups: LOOKUPS[Kind] ?? [] });
    }),
    http.post("*/api/config/fetchCustomFields", () => json({ customFields: [] })),
    http.post("*/api/users/fetchUsers", () => json({ users: USERS, pagination: page(USERS) })),
    http.post("*/api/users/fetchAssignableUsers", async ({ request }) => {
      const body = await request.json().catch(() => ({}));
      return json({ users: body?.BranchId === 2 ? [{ Id: 20, FullName: "Vikram Rao", BranchId: 2, BranchName: "SOUTH EXTENSION" }] : USERS });
    }),
    http.post("*/api/users/fetchBranches", () => json({ branches: BRANCHES })),
    http.post("*/api/products/fetchProducts", () => json({ products: PRODUCTS, pagination: page(PRODUCTS) })),
    http.post("*/api/tickets/fetchEscalationTargets", () => json({ users: SENIORS })),
    http.post("*/api/calls/fetchCalls", () => json({ calls: [] })),
  );
}

export function mockTicketEndpoints(cap = {}, { tickets = [ticketRow()], detail = ticketDetail() } = {}) {
  const status = (name) => async ({ request }) => {
    cap[name] = await request.json();
    return json({ Id: cap[name].TicketId ?? cap[name].Id ?? 7, ResponseCode: 200, ResponseMess: "ok" });
  };
  server.use(
    http.post("*/api/tickets/fetchTickets", async ({ request }) => {
      cap.list = await request.json();
      return json({ tickets, pagination: page(tickets) });
    }),
    http.post("*/api/tickets/fetchTicketDetail", async ({ request }) => {
      cap.detail = await request.json();
      return json(typeof detail === "function" ? detail(cap.detail) : detail);
    }),
    http.post("*/api/tickets/saveTicket", async ({ request }) => {
      cap.save = await request.json();
      return json({ Id: cap.save.Id || 909, TicketNo: cap.save.Id ? "TKT-0007" : "TKT-0909", ResponseCode: 200, ResponseMess: "Saved" });
    }),
    http.post("*/api/tickets/setTicketStatus", status("status")),
    http.post("*/api/tickets/transferTicket", status("transfer")),
    http.post("*/api/tickets/bulkTransferTickets", async ({ request }) => {
      cap.bulk = await request.json();
      return json({ Transferred: cap.bulk.TicketIds?.length ?? 0, Skipped: 0, ResponseCode: 200, ResponseMess: "ok" });
    }),
    http.post("*/api/tickets/escalateTicket", status("escalate")),
    http.post("*/api/tickets/deleteTicket", status("delete")),
  );
  return cap;
}

export function mockCustomerEndpoints(cap = {}, { customers = [customerRow()], detail = null } = {}) {
  server.use(
    http.post("*/api/customers/fetchCustomers", async ({ request }) => {
      cap.list = await request.json();
      const term = String(cap.list?.SearchTerm ?? "").toLowerCase();
      const rows = term
        ? customers.filter((c) => [c.Name, c.ContactPerson, c.Mobile, c.Email, c.City].some((v) => String(v ?? "").toLowerCase().includes(term)))
        : customers;
      return json({ customers: rows, pagination: page(rows) });
    }),
    http.post("*/api/customers/saveCustomer", async ({ request }) => {
      cap.save = await request.json();
      return json({ Id: cap.save.Id || 44, ResponseCode: 200, ResponseMess: "Saved" });
    }),
    http.post("*/api/customers/fetchCustomerDetail", async ({ request }) => {
      cap.detail = await request.json();
      return json(detail ?? { customer: customers[0], tickets: [] });
    }),
    http.post("*/api/customers/deleteCustomer", async ({ request }) => {
      cap.delete = await request.json();
      return json({ Id: cap.delete.Id, ResponseCode: 200, ResponseMess: "Deleted" });
    }),
  );
  return cap;
}
