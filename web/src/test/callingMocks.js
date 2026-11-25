// MSW handlers + fixtures for the calling-list screens (149). `cap.<name>` holds the
// last body posted to that endpoint, `cap.calls.<name>` every one. `fail.<name>` =
// a refusal message (or { message, status } / a function of the body returning one).
import { http, HttpResponse } from "msw";

import { server } from "./mocks/server";
import { json, refuse } from "./supportMocks";

export const listRow = (over = {}) => ({
  Id: 5, CompId: 1, BranchId: 1, BranchName: "Delhi", Name: "MLSS Delhi — Lucky draw, Nov", Vendor: "Kapoor Data House",
  PurchasedOn: "2026-11-18T00:00:00.000Z", Cost: 42000, ProductId: 3, ProductName: "Rooftop solar 3 kW", Script: "Namaste…",
  AutoTopUp: true, HoldSize: 10, MaxAttempts: 3, RetryGapHours: 4, Status: "active",
  SheetRows: 5000, SkippedDup: 365, SkippedBad: 151, SkippedDnc: 38,
  Contacts: 4186, InPool: 3402, Held: 40, Callbacks: 11, Closed: 655, Leads: 78, Eligible: 3300, CalledToday: 81,
  CreatedAt: "2026-11-18T10:00:00Z", ...over,
});

export const callerRow = (over = {}) => ({
  UserId: 17, FullName: "Rohit Sharma", Avatar: null, HoldSize: null, IsPaused: false, IsActive: true,
  Holding: 10, Callbacks: 4, CalledToday: 34, Leads: 3, ...over,
});

export const contactRow = (over = {}) => ({
  Id: 101, CallListId: 5, Name: "Mrs. HARJEET KAUR", Company: null, City: "New Delhi", State: null, Pincode: null, Email: null,
  Address: "C-14, Defence Colony", Mobile: "9810823710", AltMobile: null, Extra: null, Status: "held", CloseReason: null,
  HeldBy: 17, HeldByName: "Rohit Sharma", HeldAt: "2026-11-24T09:00:00", HeldVia: "auto", CallbackAt: null, Attempts: 0,
  LastResult: null, LastCalledAt: null, LastCalledBy: null, LastCalledByName: null, NextEligibleAt: null, Priority: 0,
  LeadId: null, RecycledAt: null, CreatedAt: "2026-11-18T10:00:00", PhoneMark: null, PhoneMarkNote: null, ...over,
});

export const markRow = (over = {}) => ({
  Id: 31, Mobile: "9899011223", Mark: "dnc", Note: "Asked never to be called again", Source: "caller", SetBy: 18,
  SetByName: "Priya Verma", SetAt: "2026-11-22T17:22:00", ClearedByName: null, ClearedAt: null, ClearNote: null,
  LeadId: null, CustomerId: null, ContactId: null, CallListId: null, ...over,
});

export const ASSIGNABLE = [
  { Id: 17, FullName: "Rohit Sharma", JobTitle: "Sales Executive", BranchName: "Delhi", GroupRank: 1 },
  { Id: 18, FullName: "Priya Verma", JobTitle: "Sales Executive", BranchName: "Delhi", GroupRank: 1 },
  { Id: 20, FullName: "Arjun Mehta", JobTitle: "Sales Executive", BranchName: "Noida", GroupRank: 3 },
];
export const COUNTS = { Added: 3, InPool: 1, IsLead: 1, IsCustomer: 0, Dnc: 1, BadNumber: 1, Repeated: 0 };

const page = (rows) => ({ currentPage: 1, pageSize: 25, totalRecords: rows.length, totalPages: 1 });

export function mockCallingEndpoints({
  lists = [listRow()], callers = ASSIGNABLE, listCallers = [callerRow()], contacts = [contactRow()], counts = COUNTS,
  skipped = [], history = { contact: contactRow(), attempts: [] }, marks = [markRow()], report = { rows: [], totals: {} },
  reportRows = { rows: [], total: 0 }, assignMessage = "18 given, the list has no more", fail = {},
} = {}) {
  const cap = { calls: {} };
  const route = (path, name, answer) => server.use(
    http.post(`*${path}`, async ({ request }) => {
      const body = await request.json().catch(() => ({}));
      cap[name] = body;
      (cap.calls[name] ??= []).push(body);
      let f = fail[name];
      if (typeof f === "function") f = f(body, cap.calls[name].length);
      if (f) return typeof f === "string" ? refuse(f, 409) : refuse(f.message, f.status ?? 409);
      const out = answer(body);
      return out instanceof Response ? out : json(out);
    }),
  );
  const c = (name, answer) => route(`/api/calling/${name}`, name, answer);
  c("fetchLists", (b) => {
    if (!b.Id) return { lists, pagination: page(lists) };
    const list = lists.find((l) => l.Id === b.Id);
    return list ? { list, callers: listCallers } : refuse("Calling list not found", 404, "SP_ERROR");
  });
  c("saveList", (b) => ({ Id: b.Id || 9, ResponseCode: 200, ResponseMess: "Calling list saved" }));
  c("deleteList", () => ({ Id: 5, ResponseCode: 200, ResponseMess: "Deleted" }));
  c("saveCallers", () => ({ ResponseCode: 200, ResponseMess: "Callers saved" }));
  c("importContacts", (b) => ({ counts: { ...counts, ResponseCode: 200 }, skipped: typeof skipped === "function" ? skipped(b) : skipped }));
  c("addContact", () => ({ counts: { ...counts, Added: 1 }, skipped: [] }));
  c("fetchContacts", () => ({ contacts, pagination: page(contacts) }));
  c("contactHistory", () => history);
  c("assign", (b) => HttpResponse.json({ success: true, message: assignMessage, responseCode: 200,
    data: { Given: b.ContactIds?.length ?? 18, Asked: 18, perCaller: [] } }));
  c("recall", () => ({ Recalled: 3 }));
  c("setState", (b) => ({ Changed: b.ContactIds?.length ?? 0 }));
  route("/api/phoneMark/fetch", "markFetch", () => ({ marks, pagination: page(marks) }));
  route("/api/phoneMark/set", "markSet", () => ({ Id: 40, ResponseCode: 200, ResponseMess: "Number marked" }));
  route("/api/phoneMark/clear", "markClear", () => ({ Id: 31, ResponseCode: 200, ResponseMess: "Mark cleared" }));
  route("/api/users/fetchAssignableUsers", "assignable", () => ({ users: callers }));
  // tblBranch.Id is BIGINT: mssql hands it over as a string ("1"), so the mock does too.
  route("/api/users/fetchBranches", "branches", () => ({ branches: [{ Id: "1", BranchName: "Delhi" }, { Id: "2", BranchName: "Noida" }] }));
  route("/api/products/fetchProducts", "products", () => ({ products: [{ Id: 3, Name: "Rooftop solar 3 kW" }], pagination: page([1]) }));
  route("/api/reports/sales", "report", () => report);
  route("/api/reports/salesRows", "reportRows", () => reportRows);
  return cap;
}
