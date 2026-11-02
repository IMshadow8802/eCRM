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
  ["fetchFollowUps", { call: () => followups.fetchFollowUps(), url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: null, DueFrom: null, DueTo: null, Overdue: false, SearchTerm: null, PageSize: 50 } }],
  ["fetchFollowUps overdue", { call: () => followups.fetchFollowUps({ Overdue: true }), url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: null, DueFrom: null, DueTo: null, Overdue: true, SearchTerm: null, PageSize: 50 } }],
  ["fetchFollowUps window", { call: () => followups.fetchFollowUps({ Status: "open", DueFrom: "2026-11-02", DueTo: "2026-11-02", SearchTerm: "ravi", PageSize: 20 }), url: "/api/followups/fetchFollowups", body: { LeadId: 0, Status: "open", DueFrom: "2026-11-02", DueTo: "2026-11-02", Overdue: false, SearchTerm: "ravi", PageSize: 20 } }],
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
