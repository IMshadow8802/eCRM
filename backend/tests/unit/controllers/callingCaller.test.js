jest.mock("../../../src/config/database");
jest.mock("../../../src/services/calendarContext");
const database = require("../../../src/config/database");
const cc = require("../../../src/services/calendarContext");
const c = require("../../../src/controllers/callingCallerController");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");
const { DEFAULT_DAYS } = require("../../../src/utils/workCalendar");

const req = (body = {}, modules = [["leads", "vae", "Own"]]) =>
  ({ body, user: { CompId: 1, UserId: 7, BranchId: 99 }, access: mockAccess({ modules }, 7) });
const calls = (n) => database.executeStoredProcedure.mock.calls.filter((x) => x[0] === n).map((x) => x[1]);
const body = (res) => res.json.mock.calls[0][0];
const myList = (toCall = [{ Id: 1, Extra: null }]) => ({ recordsets: [[{ ToCall: toCall.length }], toCall, [], [{ AttemptId: 3 }], [{ CallListId: 4 }]] });
const statusRow = (row) => ({ recordsets: [[{ Id: 0, ResponseMess: "ok", ...row }]] });

// sp name → reply; anything else gets the fresh list
function stub(map = {}) {
  database.executeStoredProcedure.mockImplementation(async (name) => (name in map ? map[name] : myList()));
}

let res;
beforeEach(() => {
  jest.resetAllMocks();
  res = mockRes();
  jest.useFakeTimers({ now: new Date("2026-11-16T06:30:00Z"), doNotFake: ["nextTick", "setImmediate"] }); // 12:00 IST
  cc.load.mockResolvedValue(new Map([[7, { ctx: { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() } }]]));
});
afterEach(() => jest.useRealTimers());

describe("myList", () => {
  it("runs the top-up and returns only shaped result sets", async () => {
    stub();
    await c.myList(req({}), res);
    expect(calls("sp_FetchMyCallList")[0]).toEqual({ CompId: 1, UserId: 7, TopUp: 1 });
    expect(Object.keys(body(res).data).sort()).toEqual(["callbacks", "done", "head", "lists", "toCall"]);
    expect(body(res).data.toCall[0].extras).toEqual([]);
  });
  it("[holding] asks for the session's person only — a UserId, HeldBy or CallListId in the body changes nothing", async () => {
    stub();
    await c.myList(req({ UserId: 99, HeldBy: 99, CallListId: 4 }), res);
    expect(Object.keys(calls("sp_FetchMyCallList")[0]).sort()).toEqual(["CompId", "TopUp", "UserId"]);
    expect(calls("sp_FetchMyCallList")[0].UserId).toBe(7);
  });
});

describe("saveResult", () => {
  it("[holding] the reply after a result is the list the procedure returned — the finished contact is not in it", async () => {
    stub({ sp_SaveCallResult: statusRow({ Id: 55, ResponseCode: 200 }), sp_FetchMyCallList: myList([{ Id: 10 }]) });
    await c.saveResult(req({ ContactId: 9, Result: "no_answer" }), res);
    expect(calls("sp_SaveCallResult")[0]).toEqual({ CompId: 1, UserId: 7, ContactId: 9, Result: "no_answer", Notes: null,
      DialedAt: null, CallbackAt: null, CallbackReleaseAt: null });
    expect(calls("sp_FetchMyCallList")[0]).toEqual({ CompId: 1, UserId: 7, TopUp: 0 });
    expect(body(res).data.AttemptId).toBe(55);
    expect(body(res).data.toCall.map((r) => r.Id)).not.toContain(9);
  });
  it("[holding] relays 404 for a contact the caller does not hold, and fetches nothing else", async () => {
    stub({ sp_SaveCallResult: statusRow({ ResponseCode: 404, ResponseMess: "Contact not found" }) });
    await c.saveResult(req({ ContactId: 9, Result: "busy" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body(res).message).toBe("Contact not found");
    expect(body(res).data).toBeUndefined();
    expect(calls("sp_FetchMyCallList")).toHaveLength(0);
  });
  it("answers 409 with the sentence and the fresh list when the contact left", async () => {
    stub({ sp_SaveCallResult: statusRow({ ResponseCode: 409, ResponseMess: "This contact is no longer on your list" }) });
    await c.saveResult(req({ ContactId: 9, Result: "busy" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body(res)).toMatchObject({ success: false, message: "This contact is no longer on your list" });
    expect(body(res).data.toCall).toBeDefined();
    expect(calls("sp_FetchMyCallList")[0].TopUp).toBe(0);
  });
  it("400s interested, an unknown result, and dnc without a note — no DB call", async () => {
    for (const b of [{ ContactId: 9, Result: "interested" }, { ContactId: 9, Result: "maybe" }, { ContactId: 9, Result: "dnc", Notes: "  " },
      { Result: "busy" }, { ContactId: 9, Result: "busy", Notes: "x".repeat(1001) }]) {
      const r = mockRes();
      await c.saveResult(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    const r = mockRes();
    await c.saveResult(req({ ContactId: 9, Result: "interested" }), r);
    expect(r.json.mock.calls[0][0].message).toBe("Use convert for an interested contact");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("stores a callback as the IST wall clock the phone sent", async () => {
    stub({ sp_SaveCallResult: statusRow({ Id: 1, ResponseCode: 200 }) });
    await c.saveResult(req({ ContactId: 9, Result: "callback", CallbackAt: "2026-11-17T16:00" }), res);
    expect(calls("sp_SaveCallResult")[0]).toMatchObject({ ContactId: 9, Result: "callback", CallbackAt: "2026-11-17T16:00:00" });
  });
  it("converts a UTC instant to IST instead of storing it raw", async () => {
    stub({ sp_SaveCallResult: statusRow({ Id: 1, ResponseCode: 200 }) });
    await c.saveResult(req({ ContactId: 9, Result: "callback", CallbackAt: "2026-11-17T10:30:00Z", DialedAt: "2026-11-16T06:00:00Z" }), res);
    expect(calls("sp_SaveCallResult")[0]).toMatchObject({ CallbackAt: "2026-11-17 16:00:00", DialedAt: "2026-11-16 11:30:00" });
  });
  it("400s a CallbackAt that is not a date, one sent with no_answer, and a bad DialedAt", async () => {
    for (const b of [{ ContactId: 9, Result: "callback", CallbackAt: "tomorrow" }, { ContactId: 9, Result: "no_answer", CallbackAt: "2026-11-17T16:00" },
      { ContactId: 9, Result: "busy", DialedAt: "2026-13-01T10:00" }]) {
      const r = mockRes();
      await c.saveResult(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("passes the working-calendar cut-off, or null when it cannot be computed", async () => {
    stub({ sp_SaveCallResult: statusRow({ Id: 1, ResponseCode: 200 }) });
    await c.saveResult(req({ ContactId: 9, Result: "callback", CallbackAt: "2026-11-17T16:00" }), res); // Tue → Wed 18:00
    expect(calls("sp_SaveCallResult")[0].CallbackReleaseAt).toBe("2026-11-18 18:00:00");
    cc.load.mockRejectedValue(new Error("down"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    await c.saveResult(req({ ContactId: 9, Result: "callback", CallbackAt: "2026-11-17T16:00" }), mockRes());
    expect(calls("sp_SaveCallResult")[1].CallbackReleaseAt).toBeNull();
  });
  it("sends a callback with no time as a plain callback, and a trimmed note", async () => {
    stub({ sp_SaveCallResult: statusRow({ Id: 1, ResponseCode: 200 }) });
    await c.saveResult(req({ ContactId: 9, Result: "dnc", Notes: "  shouted  " }), res);
    expect(calls("sp_SaveCallResult")[0]).toMatchObject({ Result: "dnc", Notes: "shouted", CallbackAt: null, CallbackReleaseAt: null });
    expect(cc.load).not.toHaveBeenCalled();
  });
});

describe("convert", () => {
  it("sends only the contact id, name, note and follow-up to sp_SaveLead", async () => {
    stub({ sp_SaveLead: statusRow({ Id: 501, ResponseCode: 200, ResponseMess: "Lead saved successfully" }) });
    await c.convert(req({ ContactId: 9, Name: "Mahesh", Notes: "wants 5kW", MobileNo: "9000000000", OwnerId: 99, SourceId: 3,
      FirstFollowupAt: "2026-11-18T11:00", DialedAt: "2026-11-16T11:55", UserId: 99 }), res);
    const p = calls("sp_SaveLead")[0];
    expect(p).toEqual({ Id: 0, CompId: 1, BranchId: 2, UserId: 7, Name: "Mahesh", Remarks: "wants 5kW",
      FirstFollowupAt: "2026-11-18T11:00:00", CallContactId: 9, CallDialedAt: "2026-11-16T11:55:00" });
    expect(calls("sp_FetchMyCallList")[0].TopUp).toBe(1);
    expect(body(res).data.LeadId).toBe(501);
    expect(body(res).data.toCall).toBeDefined();
  });
  it("defaults the first follow-up to tomorrow and leaves a blank name to the contact", async () => {
    stub({ sp_SaveLead: statusRow({ Id: 501, ResponseCode: 200 }) });
    await c.convert(req({ ContactId: 9 }), res);
    expect(calls("sp_SaveLead")[0]).toMatchObject({ FirstFollowupAt: "2026-11-17", Name: null, Remarks: null, CallDialedAt: null });
  });
  it("[holding] relays 404 / 409 for a contact the caller does not hold", async () => {
    stub({ sp_SaveLead: statusRow({ ResponseCode: 404, ResponseMess: "Contact not found" }) });
    await c.convert(req({ ContactId: 9 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(calls("sp_FetchMyCallList")).toHaveLength(0);
    stub({ sp_SaveLead: statusRow({ ResponseCode: 409, ResponseMess: "This contact is no longer on your list" }) });
    const r = mockRes();
    await c.convert(req({ ContactId: 9 }), r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json.mock.calls[0][0].data.toCall).toBeDefined();
  });
  it("400s a missing contact, a bad follow-up or dial time, and a long note", async () => {
    for (const b of [{}, { ContactId: 9, FirstFollowupAt: "soon" }, { ContactId: 9, DialedAt: "x" }, { ContactId: 9, Notes: "x".repeat(1001) }]) {
      const r = mockRes();
      await c.convert(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

describe("undoResult", () => {
  it("400s a missing id and passes the procedure's 409 through", async () => {
    await c.undoResult(req({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    stub({ sp_UndoCallResult: statusRow({ ResponseCode: 409, ResponseMess: "This can no longer be undone; ask your manager" }) });
    const r = mockRes();
    await c.undoResult(req({ AttemptId: 3 }), r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json.mock.calls[0][0].message).toBe("This can no longer be undone; ask your manager");
  });
  it("undoes and returns the fresh list without a top-up", async () => {
    stub({ sp_UndoCallResult: statusRow({ Id: 3, ResponseCode: 200, ResponseMess: "Undone" }) });
    await c.undoResult(req({ AttemptId: 3 }), res);
    expect(calls("sp_UndoCallResult")[0]).toEqual({ CompId: 1, UserId: 7, AttemptId: 3 });
    expect(calls("sp_FetchMyCallList")[0].TopUp).toBe(0);
    expect(body(res).message).toBe("Undone");
    expect(body(res).data.head).toBeDefined();
  });
  it("[holding] relays 404", async () => {
    stub({ sp_UndoCallResult: statusRow({ ResponseCode: 404, ResponseMess: "Contact not found" }) });
    await c.undoResult(req({ AttemptId: 3 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

it("[holding] the controller has no fetch-by-id, list or search method", () => {
  expect(Object.keys(c).sort()).toEqual(["convert", "myList", "saveResult", "undoResult"]);
});

it("a database failure is one 500", async () => {
  database.executeStoredProcedure.mockRejectedValue(new Error("down"));
  jest.spyOn(console, "error").mockImplementation(() => {});
  await c.myList(req({}), res);
  expect(res.status).toHaveBeenCalledWith(500);
});
