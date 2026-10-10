const database = require("../../../src/config/database");
jest.mock("../../../src/config/database");
const c = require("../../../src/controllers/partnerController");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");
const req = (body = {}, modules = []) => ({ body, user: { CompId: 1, UserId: 5 }, access: mockAccess({ modules }, 5) });
const ok = (row = { Id: 1, ResponseCode: 200, ResponseMess: "ok" }) => ({ recordset: [row], recordsets: [[row]] });

describe("partnerController", () => {
  beforeEach(() => jest.resetAllMocks());

  it("savePartner normalises a mobile and passes the terms through", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    const res = mockRes();
    await c.savePartner(req({ Name: "Sharma Traders", Mobile: "+91 98250 12345", CommType: "pct", CommValue: 10 }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SavePartner", expect.objectContaining({
      Id: 0, CompId: 1, UserId: 5, Name: "Sharma Traders", Mobile: "9825012345", CommType: "pct", CommValue: 10 }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("savePartner 400s a bad mobile before the DB", async () => {
    const res = mockRes();
    await c.savePartner(req({ Name: "X", Mobile: "12345" }), res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("savePartner 400s a percent over 100 and terms without a type", async () => {
    for (const body of [{ Name: "X", CommType: "pct", CommValue: 120 }, { Name: "X", CommValue: 5 }]) {
      const res = mockRes();
      await c.savePartner(req(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("savePartner surfaces the duplicate-mobile 409", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok({ Id: 0, ResponseCode: 409, ResponseMess: "Another partner already has this mobile number" }));
    const res = mockRes();
    await c.savePartner(req({ Name: "X", Mobile: "9825012345" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("fetchCommissions 400s an unknown status", async () => {
    const res = mockRes();
    await c.fetchCommissions(req({ Status: "lost" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("fetchCommissions returns the commission rows only, one result set", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 1, Amount: 0 }]] });
    const res = mockRes();
    await c.fetchCommissions(req({ PartnerId: 2, FromDate: "nope", ToDate: "2026-10-10" }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchCommissions", { CompId: 1, PartnerId: 2, Status: null, FromDate: null, ToDate: "2026-10-10" });
    expect(res.json.mock.calls[0][0].data).toEqual({ commissions: [{ Id: 1, Amount: 0 }] });
  });

  it("setCommissionStatus: due sends ids as JSON, no payment fields", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok());
    const res = mockRes();
    await c.setCommissionStatus(req({ Ids: [4, 4, "x", 7], ToStatus: "due" }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SetCommissionStatus",
      { CompId: 1, UserId: 5, IdsJson: "[4,7]", ToStatus: "due", PaidAt: null, PaidRef: null });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("setCommissionStatus: paid sends the date and reference; a 409 passes through", async () => {
    database.executeStoredProcedure.mockResolvedValue(ok({ Id: 0, ResponseCode: 409, ResponseMess: "Nothing changed" }));
    const res = mockRes();
    await c.setCommissionStatus(req({ Ids: [4], ToStatus: "paid", PaidAt: "2026-10-10", PaidRef: " UTR1 " }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SetCommissionStatus",
      { CompId: 1, UserId: 5, IdsJson: "[4]", ToStatus: "paid", PaidAt: "2026-10-10", PaidRef: "UTR1" });
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it.each([
    [{ Ids: [], ToStatus: "due" }],
    [{ Ids: [1], ToStatus: "cancelled" }],
    [{ Ids: [1], ToStatus: "paid" }],
    [{ Ids: [1], ToStatus: "paid", PaidAt: "2026-02-30" }],
  ])("setCommissionStatus 400s %j before the DB", async (body) => {
    const res = mockRes();
    await c.setCommissionStatus(req(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("fetchPartners with partners view: full columns, Stats on by default", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 1, Name: "A", City: "X", CommType: "pct", CommValue: 5, Leads: 2 }]] });
    const res = mockRes();
    await c.fetchPartners(req({ IncludeInactive: true }, [["partners"]]), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchPartners", { CompId: 1, IncludeInactive: 1, WithStats: 1 });
    expect(res.json.mock.calls[0][0].data.partners[0]).toHaveProperty("Leads", 2);
    await c.fetchPartners(req({ Stats: false }, [["partners"]]), mockRes());
    expect(database.executeStoredProcedure.mock.calls.at(-1)[1]).toMatchObject({ WithStats: 0 });
  });

  it("fetchPartners for a leads-only caller: no stats, only Id/Name/City, never inactive", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ Id: 1, Name: "A", City: "X", CommType: "pct", CommValue: 5 }]] });
    const res = mockRes();
    await c.fetchPartners(req({ IncludeInactive: true, Stats: true }, [["leads"]]), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchPartners", { CompId: 1, IncludeInactive: 0, WithStats: 0 });
    expect(res.json.mock.calls[0][0].data.partners).toEqual([{ Id: 1, Name: "A", City: "X" }]);
  });

  it("fetchPartners 403s a caller with neither leads nor partners view", async () => {
    const res = mockRes();
    await c.fetchPartners(req({}, [["tasks"]]), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("fetchPartners lets an admin through", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[]] });
    const r = req({});
    r.access = mockAccess({ admin: true }, 5);
    const res = mockRes();
    await c.fetchPartners(r, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("savePartner 400s a missing name; update keeps Id and IsActive false", async () => {
    let res = mockRes();
    await c.savePartner(req({ Name: " " }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    database.executeStoredProcedure.mockResolvedValue(ok());
    res = mockRes();
    await c.savePartner(req({ Id: 3, Name: "A", IsActive: false }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SavePartner", expect.objectContaining({ Id: 3, IsActive: 0, Mobile: null, CommType: null, CommValue: null }));
  });
});
