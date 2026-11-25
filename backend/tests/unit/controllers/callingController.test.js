jest.mock("../../../src/config/database");
jest.mock("../../../src/realtime/events", () => ({ emitToUser: jest.fn() }));
const database = require("../../../src/config/database");
const { emitToUser } = require("../../../src/realtime/events");
const { SCOPES } = require("../../../src/realtime/contract");
const c = require("../../../src/controllers/callingController");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");

const req = (body = {}, { modules = [["calling", "vaed"]], admin = false } = {}) => {
  const access = mockAccess({ modules, admin }, 7);
  return { body, user: { CompId: 1, UserId: 7, BranchId: 99 }, access, scope: { isAdmin: admin } };
};
const status = (row) => ({ recordsets: [[{ Id: 4, ResponseCode: 200, ResponseMess: "ok", ...row }]] });
const sent = (n = 0) => database.executeStoredProcedure.mock.calls[n][1];
const body = (res) => res.json.mock.calls[0][0];

let res;
beforeEach(() => { jest.resetAllMocks(); res = mockRes(); });

describe("importContacts", () => {
  it("cleans every row and sends only the person, the list and the rows", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200, Added: 1, BadNumber: 1 }], [{ RowNo: 2, Reason: "bad" }]] });
    await c.importContacts(req({ CallListId: 4, DryRun: true, rows: [{ RowNo: 1, Mobile: "+91 98250 12345" }, { RowNo: 2, Mobile: "123" }] }), res);
    const p = sent();
    expect(database.executeStoredProcedure.mock.calls[0][0]).toBe("sp_ImportCallContacts");
    expect(JSON.parse(p.RowsJson).map((r) => r.Mobile)).toEqual(["9825012345", null]);
    expect(Object.keys(p).sort()).toEqual(["CallListId", "CompId", "DryRun", "RowsJson", "UserId"]);
    expect(p).toMatchObject({ CompId: 1, UserId: 7, CallListId: 4, DryRun: 1 });
    expect(body(res).data.skipped).toEqual([{ RowNo: 2, Reason: "Bad number" }]);
    expect(body(res).data.counts).toMatchObject({ Added: 1, BadNumber: 1 });
  });
  it("promotes a good alt number over an empty mobile, and sends extras as a JSON object", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200 }], []] });
    await c.importContacts(req({ CallListId: 4, DryRun: false, rows: [{ RowNo: 1, Mobile: "", AltMobile: "9898011111", Extra: { Turnover: "2 Cr" } }] }), res);
    const row = JSON.parse(sent().RowsJson)[0];
    expect(row).toMatchObject({ Mobile: "9898011111", AltMobile: null, Extra: { Turnover: "2 Cr" } });
    expect(sent().DryRun).toBe(0);
  });
  it("treats a missing DryRun as a dry run", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200 }], []] });
    await c.importContacts(req({ CallListId: 4, rows: [{ RowNo: 1, Mobile: "9825012345" }] }), res);
    expect(sent().DryRun).toBe(1);
  });
  it("400s more than 500 rows, an empty chunk and a missing list id before the DB", async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ RowNo: i, Mobile: "9825012345" }));
    for (const b of [{ CallListId: 4, rows: many }, { CallListId: 4, rows: [] }, { CallListId: 4 }, { rows: [{ RowNo: 1 }] }]) {
      const r = mockRes();
      await c.importContacts(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("400s a chunk with a non-object row or a bad RowNo, never a 500", async () => {
    for (const rows of [[null], ["9825012345"], [[1, 2]], [{ RowNo: 0, Mobile: "9825012345" }], [{ RowNo: "x" }], [{ Mobile: "9825012345" }]]) {
      const r = mockRes();
      await c.importContacts(req({ CallListId: 4, rows }), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("coerces a numeric-string RowNo", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200 }], []] });
    await c.importContacts(req({ CallListId: 4, rows: [{ RowNo: "7", Mobile: "9825012345" }] }), res);
    expect(JSON.parse(sent().RowsJson)[0].RowNo).toBe(7);
  });
  it("relays the procedure's 404 with its sentence", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 404, ResponseMess: "Calling list not found" }]] });
    await c.importContacts(req({ CallListId: 4, rows: [{ RowNo: 1 }] }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body(res).message).toBe("Calling list not found");
  });
  it("keeps an unknown reason code as it came", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200 }], [{ RowNo: 1, Reason: "odd" }]] });
    await c.importContacts(req({ CallListId: 4, rows: [{ RowNo: 1 }] }), res);
    expect(body(res).data.skipped).toEqual([{ RowNo: 1, Reason: "odd" }]);
  });
});

describe("addContact", () => {
  it("imports one cleaned row for real", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200, Added: 1 }], []] });
    await c.addContact(req({ CallListId: 4, Name: " Mahesh ", Mobile: "98250 12345", City: "Surat" }), res);
    expect(sent().DryRun).toBe(0);
    expect(JSON.parse(sent().RowsJson)).toEqual([expect.objectContaining({ RowNo: 1, Name: "Mahesh", Mobile: "9825012345", City: "Surat" })]);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("409s with the reason sentence when the row was skipped", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200, Added: 0 }], [{ RowNo: 1, Reason: "lead" }]] });
    await c.addContact(req({ CallListId: 4, Mobile: "9825012345" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body(res).message).toBe("Already a lead");
  });
  it("400s a missing list id", async () => {
    await c.addContact(req({ Mobile: "9825012345" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("400s a bad mobile before the DB (a validation error, not a 409)", async () => {
    for (const Mobile of ["123", "5825012345", "", undefined]) {
      const r = mockRes();
      await c.addContact(req({ CallListId: 4, Mobile }), r);
      expect(r.status).toHaveBeenCalledWith(400);
      expect(r.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("accepts a good alt number in place of a bad mobile", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200, Added: 1 }], []] });
    await c.addContact(req({ CallListId: 4, Mobile: "", AltMobile: "9898011111" }), res);
    expect(JSON.parse(sent().RowsJson)[0].Mobile).toBe("9898011111");
  });
});

describe("fetchLists", () => {
  const rows = { recordsets: [[{ Id: 4, Name: "Surat", Cost: 5000 }], [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 25 }], [{ UserId: 9 }]] };
  it("gives Cost to an admin and null to a list manager", async () => {
    database.executeStoredProcedure.mockResolvedValue(rows);
    await c.fetchLists(req({}, { admin: true }), res);
    expect(body(res).data.lists[0].Cost).toBe(5000);
    database.executeStoredProcedure.mockResolvedValue(rows);
    const r2 = mockRes();
    await c.fetchLists(req({}), r2);
    expect(r2.json.mock.calls[0][0].data.lists[0].Cost).toBeNull();
    expect(r2.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });
  it("with an Id returns the list and its callers, or 404", async () => {
    database.executeStoredProcedure.mockResolvedValue(rows);
    await c.fetchLists(req({ Id: 4, UserId: 99, CompId: 99 }), res);
    expect(sent()).toMatchObject({ CompId: 1, UserId: 7, Id: 4 });
    expect(body(res).data).toEqual({ list: { Id: 4, Name: "Surat", Cost: null }, callers: [{ UserId: 9 }] });
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], [{}], []] });
    const r2 = mockRes();
    await c.fetchLists(req({ Id: 4 }), r2);
    expect(r2.status).toHaveBeenCalledWith(404);
  });
  it("passes status, search and clamped paging; an unknown status is dropped", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], []] });
    await c.fetchLists(req({ Status: "paused", SearchTerm: " sur ", PageSize: 9999 }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, Id: null, Status: "paused", SearchTerm: "sur", PageNumber: 1, PageSize: 200 });
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], []] });
    await c.fetchLists(req({ Status: "gone" }), mockRes());
    expect(sent(1).Status).toBeNull();
    expect(body(res).data.pagination.totalRecords).toBe(0);
  });
});

describe("saveList / deleteList / saveCallers", () => {
  it("saveList sends the list fields and relays the procedure's 403 for an office outside reach", async () => {
    database.executeStoredProcedure.mockResolvedValue(status({ Id: 0, ResponseCode: 403, ResponseMess: "You cannot create a list for that office" }));
    await c.saveList(req({ BranchId: 3, Name: " Surat traders ", Cost: "5000", AutoTopUp: true, HoldSize: 10, PurchasedOn: "2026-11-01" }), res);
    expect(sent()).toMatchObject({ CompId: 1, UserId: 7, Id: 0, BranchId: 3, Name: "Surat traders", Cost: 5000, AutoTopUp: 1,
      HoldSize: 10, MaxAttempts: 3, RetryGapHours: 4, PurchasedOn: "2026-11-01", Status: null });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(body(res).message).toBe("You cannot create a list for that office");
  });
  it("saveList 400s a bad purchase date and a bad cost before the DB", async () => {
    for (const b of [{ Name: "x", PurchasedOn: "2026-02-30" }, { Name: "x", Cost: "abc" }]) {
      const r = mockRes();
      await c.saveList(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("saveList on an edit passes the id and a 200 through", async () => {
    database.executeStoredProcedure.mockResolvedValue(status());
    await c.saveList(req({ Id: 4, Name: "x", AutoTopUp: false, Status: "archived" }), res);
    expect(sent()).toMatchObject({ Id: 4, AutoTopUp: 0, Status: "archived", Cost: null, PurchasedOn: null });
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("deleteList passes the procedure's 409 through with its sentence", async () => {
    database.executeStoredProcedure.mockResolvedValue(status({ ResponseCode: 409, ResponseMess: "This list has calls; archive it instead" }));
    await c.deleteList(req({ Id: 4 }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, Id: 4 });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body(res).message).toBe("This list has calls; archive it instead");
  });
  it("deleteList 400s a missing id", async () => {
    await c.deleteList(req({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("saveCallers serialises the callers and relays a 403", async () => {
    database.executeStoredProcedure.mockResolvedValue(status({ ResponseCode: 403, ResponseMess: "You cannot give contacts to that person" }));
    await c.saveCallers(req({ CallListId: 4, Callers: [{ UserId: 9, HoldSize: 5, IsPaused: false, Remove: false, Extra: 1 }, { UserId: "x" }] }), res);
    expect(JSON.parse(sent().CallersJson)).toEqual([{ UserId: 9, HoldSize: 5, IsPaused: 0, Remove: 0 }]);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it("saveCallers 400s no callers and no list", async () => {
    for (const b of [{ CallListId: 4, Callers: [] }, { Callers: [{ UserId: 9 }] }]) {
      const r = mockRes();
      await c.saveCallers(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
  });
});

describe("fetchContacts / contactHistory", () => {
  it("clamps the page size and ignores a UserId or CompId in the body", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 1 }], [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 200 }]] });
    await c.fetchContacts(req({ CallListId: 4, PageSize: 5000, UserId: 99, CompId: 99, Status: "held", Stale: true, HeldBy: "9" }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, CallListId: 4, Status: "held", HeldBy: 9, LastResult: null, City: null,
      Stale: 1, Missed: 0, SearchTerm: null, PageNumber: 1, PageSize: 200 });
    expect(body(res).data.contacts).toEqual([{ Id: 1 }]);
  });
  it("passes the procedure's 404 through", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 4, ResponseCode: 404, ResponseMess: "Calling list not found" }]] });
    await c.fetchContacts(req({ CallListId: 4 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body(res).message).toBe("Calling list not found");
  });
  it("fetchContacts 400s a missing list and an unknown status", async () => {
    for (const b of [{}, { CallListId: 4, Status: "gone" }]) {
      const r = mockRes();
      await c.fetchContacts(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
  });
  it("contactHistory returns the contact and its attempts, 404 when out of view", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 9, ResponseCode: 200, Extra: '{"Turnover":"2 Cr"}' }], [{ Id: 1 }]] });
    await c.contactHistory(req({ ContactId: 9 }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, ContactId: 9 });
    expect(body(res).data).toEqual({ contact: { Id: 9, ResponseCode: 200, extras: [{ label: "Turnover", value: "2 Cr" }] }, attempts: [{ Id: 1 }] });
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], []] });
    const r2 = mockRes();
    await c.contactHistory(req({ ContactId: 9 }), r2);
    expect(r2.status).toHaveBeenCalledWith(404);
    const r3 = mockRes();
    await c.contactHistory(req({}), r3);
    expect(r3.status).toHaveBeenCalledWith(400);
  });
});

describe("assign / recall / setState", () => {
  const given = { recordsets: [[{ Id: 4, ResponseCode: 200, ResponseMess: "30 contacts given", Given: 30, Asked: 30 }], [{ UserId: 7, Given: 20 }, { UserId: 9, Given: 10 }], [{ UserId: 7 }, { UserId: 9 }]] };
  it("400s when neither Assign nor ContactIds is sent, and more than 500 ids", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    for (const b of [{ CallListId: 4 }, { CallListId: 4, ContactIds: ids, ToUserId: 9 }, { CallListId: 4, ContactIds: [1] }, { Assign: [{ UserId: 9, Count: 1 }] }]) {
      const r = mockRes();
      await c.assign(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("sends a split as AssignJson and emits the notifications scope to each caller the procedure names", async () => {
    database.executeStoredProcedure.mockResolvedValue(given);
    await c.assign(req({ CallListId: 4, Assign: [{ UserId: 7, Count: 20 }, { UserId: 9, Count: 10 }, { UserId: 0, Count: 5 }] }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, CallListId: 4, AssignJson: JSON.stringify([{ UserId: 7, Count: 20 }, { UserId: 9, Count: 10 }]), ContactIdsJson: null, ToUserId: null });
    expect(emitToUser).toHaveBeenCalledTimes(2);
    expect(emitToUser).toHaveBeenCalledWith(9, SCOPES.NOTIFICATIONS);
    expect(body(res).data).toEqual({ Given: 30, Asked: 30, perCaller: [{ UserId: 7, Given: 20 }, { UserId: 9, Given: 10 }] });
  });
  it("sends exact rows as ContactIdsJson + ToUserId", async () => {
    database.executeStoredProcedure.mockResolvedValue(given);
    await c.assign(req({ CallListId: 4, ContactIds: [3, 3, "x", 5], ToUserId: 9 }), res);
    expect(sent()).toMatchObject({ AssignJson: null, ContactIdsJson: "[3,5]", ToUserId: 9 });
  });
  it("relays the 403 when the target is outside can-assign-to, and emits nothing", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 403, ResponseMess: "You cannot give contacts to that person" }], [], []] });
    await c.assign(req({ CallListId: 4, Assign: [{ UserId: 9, Count: 1 }] }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(body(res).message).toBe("You cannot give contacts to that person");
    expect(emitToUser).not.toHaveBeenCalled();
  });
  it("recall passes the optional filters and returns Recalled", async () => {
    database.executeStoredProcedure.mockResolvedValue(status({ Recalled: 3 }));
    await c.recall(req({ CallListId: 4, FromUserId: 9, IncludeCallbacks: true }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, CallListId: 4, FromUserId: 9, ContactIdsJson: null, IncludeCallbacks: 1 });
    expect(body(res).data).toEqual({ Recalled: 3 });
    database.executeStoredProcedure.mockResolvedValue(status({ Recalled: 1 }));
    await c.recall(req({ CallListId: 4, ContactIds: [2] }), mockRes());
    expect(sent(1)).toMatchObject({ FromUserId: null, ContactIdsJson: "[2]", IncludeCallbacks: 0 });
    const r = mockRes();
    await c.recall(req({}), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
  it("setState 400s an action outside remove, recycle, move, priority, and no contacts", async () => {
    for (const b of [{ CallListId: 4, ContactIds: [1], Action: "delete" }, { CallListId: 4, ContactIds: [], Action: "remove" },
      { CallListId: 4, ContactIds: [1], Action: "move" }]) {
      const r = mockRes();
      await c.setState(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("setState sends the action and returns Changed; a move carries the target", async () => {
    database.executeStoredProcedure.mockResolvedValue(status({ Changed: 2 }));
    await c.setState(req({ CallListId: 4, ContactIds: [1, 2], Action: "move", ToUserId: 9 }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, CallListId: 4, ContactIdsJson: "[1,2]", Action: "move", ToUserId: 9 });
    expect(body(res).data).toEqual({ Changed: 2 });
  });
  it("setState relays a 409 with its sentence", async () => {
    database.executeStoredProcedure.mockResolvedValue(status({ ResponseCode: 409, ResponseMess: "That person would hold more than 20 callbacks", Changed: 0 }));
    await c.setState(req({ CallListId: 4, ContactIds: [1], Action: "recycle" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body(res).message).toBe("That person would hold more than 20 callbacks");
  });
});

it("a database failure is one 500", async () => {
  database.executeStoredProcedure.mockRejectedValue(new Error("down"));
  jest.spyOn(console, "error").mockImplementation(() => {});
  await c.deleteList(req({ Id: 4 }), res);
  expect(res.status).toHaveBeenCalledWith(500);
});
