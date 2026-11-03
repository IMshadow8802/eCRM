// Follow-up fetchers against backend/src/controllers/followupController.js.
// Only the wire is fake (src/test/transport).
import { lastRequest, respond } from "../test/transport";
import * as followups from "./followupQueries";

const ENVELOPE = { success: true, message: "OK", data: { Id: 1, NextId: null } };

interface Case {
  call: () => Promise<unknown>;
  url: string;
  body: unknown;
}

const CASES: [string, Case][] = [
  ["fetchFollowUps", { call: () => followups.fetchFollowUps(), url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: null, DueFrom: null, DueTo: null, Overdue: false, SearchTerm: null, PageNumber: 1, PageSize: 50 } }],
  ["fetchFollowUps overdue", { call: () => followups.fetchFollowUps({ Overdue: true }), url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: null, DueFrom: null, DueTo: null, Overdue: true, SearchTerm: null, PageNumber: 1, PageSize: 50 } }],
  ["fetchFollowUps window", { call: () => followups.fetchFollowUps({ Status: "open", DueFrom: "2026-11-02", DueTo: "2026-11-02", SearchTerm: "ravi", PageNumber: 3, PageSize: 20 }), url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: "open", DueFrom: "2026-11-02", DueTo: "2026-11-02", Overdue: false, SearchTerm: "ravi", PageNumber: 3, PageSize: 20 } }],
  // 118: a DoneAt bracket goes only when set, so a DB without 118 is never sent the keys.
  ["fetchFollowUps done today", { call: () => followups.fetchFollowUps({ Status: "done", DoneFrom: "2026-11-02", DoneTo: "2026-11-03" }), url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: "done", DueFrom: null, DueTo: null, DoneFrom: "2026-11-02", DoneTo: "2026-11-03", Overdue: false, SearchTerm: null, PageNumber: 1, PageSize: 50 } }],
  // "Mine" (§7.9 ruling): AssignedTo goes only when set; the queue never sends it.
  ["fetchFollowUps mine", { call: () => followups.fetchFollowUps({ Overdue: true, AssignedTo: 7 }), url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: null, DueFrom: null, DueTo: null, AssignedTo: 7, Overdue: true, SearchTerm: null, PageNumber: 1, PageSize: 50 } }],
  // A variable (not a literal) escapes TS's excess-property check; a LeadId in
  // it would flip the controller to per-lead mode, which has no pagination.
  ["fetchFollowUps pins the queue", { call: () => { const p = { Overdue: true, LeadId: 9 }; return followups.fetchFollowUps(p); }, url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: null, DueFrom: null, DueTo: null, Overdue: true, SearchTerm: null, PageNumber: 1, PageSize: 50 } }],
  ["scheduleFollowUp", { call: () => followups.scheduleFollowUp({ LeadId: 9, Type: "visit", DueAt: "2026-11-03" }), url: "/api/followups/scheduleFollowUp", body: { LeadId: 9, Type: "visit", DueAt: "2026-11-03", AssignedTo: null } }],
  ["scheduleFollowUp assigned", { call: () => followups.scheduleFollowUp({ LeadId: 9, Type: "call", DueAt: "2026-11-03", AssignedTo: 4 }), url: "/api/followups/scheduleFollowUp", body: { LeadId: 9, Type: "call", DueAt: "2026-11-03", AssignedTo: 4 } }],
  ["completeFollowUp", { call: () => followups.completeFollowUp({ Id: 1, Remarks: "x" }), url: "/api/followups/completeFollowUp", body: { Id: 1, Remarks: "x", OutcomeId: null, Direction: null, Duration: null, NextType: null, NextDueAt: null } }],
  ["completeFollowUp full", { call: () => followups.completeFollowUp({ Id: 1, Remarks: "x", OutcomeId: 3, Direction: "out", Duration: 5, NextType: "meeting", NextDueAt: "2026-11-05" }), url: "/api/followups/completeFollowUp", body: { Id: 1, Remarks: "x", OutcomeId: 3, Direction: "out", Duration: 5, NextType: "meeting", NextDueAt: "2026-11-05" } }],
  ["skipFollowUp", { call: () => followups.skipFollowUp({ Id: 1, Remarks: "no answer" }), url: "/api/followups/skipFollowUp", body: { Id: 1, Remarks: "no answer" } }],
];

describe.each(CASES)("%s", (_name, c) => {
  it("posts its documented body to its endpoint and resolves the envelope", async () => {
    respond(ENVELOPE);
    await expect(c.call()).resolves.toEqual(ENVELOPE);
    expect(lastRequest().url).toBe(c.url);
    expect(lastRequest().config.method).toBe("post");
    expect(lastRequest().body).toStrictEqual(c.body);
  });
});
