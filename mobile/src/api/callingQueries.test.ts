// Calling fetchers against backend/src/controllers/callingCallerController.js.
// The phone can only ask for "my list": no list id, no contact to read, no search.
import { lastRequest, respond } from "../test/transport";
import * as calling from "./callingQueries";

const ENVELOPE = { success: true, message: "OK", data: { head: {}, toCall: [], callbacks: [], done: [], lists: [] } };

const CASES: [string, { call: () => Promise<unknown>; url: string; body: unknown }][] = [
  ["fetchMyCallList", { call: () => calling.fetchMyCallList(), url: "/api/calling/myList", body: {} }],
  ["saveCallResult bare", { call: () => calling.saveCallResult({ ContactId: 9, Result: "no_answer" }), url: "/api/calling/saveResult",
    body: { ContactId: 9, Result: "no_answer", Notes: null, DialedAt: null, CallbackAt: null } }],
  ["saveCallResult full", { call: () => calling.saveCallResult({ ContactId: 9, Result: "callback", Notes: "after 6", DialedAt: "2026-11-24T16:05", CallbackAt: "2026-11-25T11:00" }),
    url: "/api/calling/saveResult", body: { ContactId: 9, Result: "callback", Notes: "after 6", DialedAt: "2026-11-24T16:05", CallbackAt: "2026-11-25T11:00" } }],
  ["saveCallResult drops a stray key", { call: () => { const p = { ContactId: 9, Result: "busy" as const, CallListId: 3 }; return calling.saveCallResult(p); },
    url: "/api/calling/saveResult", body: { ContactId: 9, Result: "busy", Notes: null, DialedAt: null, CallbackAt: null } }],
  ["convertCallContact", { call: () => calling.convertCallContact({ ContactId: 9, Name: "Harjeet", FirstFollowupAt: "2026-11-25" }), url: "/api/calling/convert",
    body: { ContactId: 9, Name: "Harjeet", Notes: null, FirstFollowupAt: "2026-11-25", DialedAt: null } }],
  ["convertCallContact full", { call: () => { const p = { ContactId: 9, Name: "H", Notes: "3 kW", FirstFollowupAt: "2026-11-25T12:00", DialedAt: "2026-11-24T16:05", Mobile: "9" }; return calling.convertCallContact(p); },
    url: "/api/calling/convert", body: { ContactId: 9, Name: "H", Notes: "3 kW", FirstFollowupAt: "2026-11-25T12:00", DialedAt: "2026-11-24T16:05" } }],
  ["undoCallResult", { call: () => calling.undoCallResult(41), url: "/api/calling/undoResult", body: { AttemptId: 41 } }],
];

describe.each(CASES)("%s", (_name, c) => {
  it("posts exactly its keys to its endpoint and resolves the envelope", async () => {
    respond(ENVELOPE);
    await expect(c.call()).resolves.toEqual(ENVELOPE);
    expect(lastRequest().url).toBe(c.url);
    expect(lastRequest().config.method).toBe("post");
    expect(lastRequest().body).toStrictEqual(c.body);
  });
});

it("exports no fetcher beyond the caller's four", () => {
  expect(Object.keys(calling).sort()).toEqual(["convertCallContact", "fetchMyCallList", "saveCallResult", "undoCallResult"]);
});
