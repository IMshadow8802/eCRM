jest.mock("../../../src/config/database");
const database = require("../../../src/config/database");
const c = require("../../../src/controllers/phoneMarkController");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");

const req = (body = {}, { modules = [["calling", "ve"]], admin = false } = {}) =>
  ({ body, user: { CompId: 1, UserId: 7 }, access: mockAccess({ modules, admin }, 7), scope: { isAdmin: admin } });
const ok = (row = {}) => ({ recordsets: [[{ Id: 3, ResponseCode: 200, ResponseMess: "Marked", ...row }]] });
const sent = (n = 0) => database.executeStoredProcedure.mock.calls[n][1];
const body = (res) => res.json.mock.calls[0][0];

let res;
beforeEach(() => { jest.resetAllMocks(); res = mockRes(); });

describe("set", () => {
  it("normalises the number and sends Source caller for a non-admin, whatever the body says", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    await c.set(req({ Mobile: "+91 98250 12345", Mark: "dnc", Note: "  angry  ", Source: "admin", UserId: 99 }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SetPhoneMark",
      { CompId: 1, UserId: 7, Mobile: "9825012345", Mark: "dnc", Note: "angry", Source: "caller" });
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("an admin's mark is Source admin", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    await c.set(req({ Mobile: "9825012345", Mark: "caution", Note: "x" }, { modules: [], admin: true }), res);
    expect(sent().Source).toBe("admin");
  });
  it("400s a nine-digit number, a missing note, a long note and a Mark of block, all before the DB", async () => {
    for (const b of [{ Mobile: "982501234", Mark: "dnc", Note: "x" }, { Mobile: "9825012345", Mark: "dnc", Note: " " },
      { Mobile: "9825012345", Mark: "dnc", Note: "x".repeat(501) }, { Mobile: "9825012345", Mark: "block", Note: "x" }]) {
      const r = mockRes();
      await c.set(req(b), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("passes the procedure's 409 through", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok({ ResponseCode: 409, ResponseMess: "This number is already marked do not call" }));
    await c.set(req({ Mobile: "9825012345", Mark: "caution", Note: "x" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body(res).message).toBe("This number is already marked do not call");
  });
});

describe("clear", () => {
  it("400s a missing note and a missing id", async () => {
    for (const b of [{ Id: 3 }, { ClearNote: "x" }]) {
      const r = mockRes();
      await c.clear(req(b, { admin: true }), r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("sends the id and the note", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok({ ResponseMess: "Mark cleared" }));
    await c.clear(req({ Id: 3, ClearNote: " wrong person " }, { admin: true }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, Id: 3, ClearNote: "wrong person" });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("fetch", () => {
  it("passes search, history and paging; returns marks and pagination", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 3 }], [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 25 }]] });
    await c.fetch(req({ SearchTerm: " 98250 ", History: true, PageSize: 999, UserId: 99 }), res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, SearchTerm: "98250", History: 1, PageNumber: 1, PageSize: 200 });
    expect(body(res).data).toEqual({ marks: [{ Id: 3 }], pagination: { currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 } });
  });
  it("an empty body is the live list, page one", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], []] });
    await c.fetch({ ...req(), body: undefined }, res);
    expect(sent()).toEqual({ CompId: 1, UserId: 7, SearchTerm: null, History: 0, PageNumber: 1, PageSize: 25 });
  });
});
