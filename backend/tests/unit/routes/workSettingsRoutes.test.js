let mockAcc;
jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => { req.user = { UserId: 7, CompId: 1, BranchId: 2 }; next(); },
}));
jest.mock("../../../src/middleware/permission", () => ({
  ...jest.requireActual("../../../src/middleware/permission"),
  loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next),
}));

const express = require("express");
const request = require("supertest");
const database = require("../../../src/config/database");
const { mockAccess } = require("../../helpers/mockAccess");

const app = express();
app.use(express.json());
app.use("/api/work", require("../../../src/routes/workSettingsRoutes"));

beforeEach(() => database.executeStoredProcedure.mockReset());
const okRow = { recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", Id: 1 }]] };

describe("workSettingsRoutes", () => {
  it("fetchWorkSettings is open to any signed-in user, even with an empty body", async () => {
    mockAcc = mockAccess({ modules: [] });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{}], [], []] });
    const r = await request(app).post("/api/work/fetchWorkSettings").send({});
    expect(r.status).toBe(200);
  });

  it("settings writes need the settings module; the right action is checked", async () => {
    mockAcc = mockAccess({ modules: [["settings", "v"]] });
    for (const url of ["saveCompanySetting", "saveWorkCalendar", "deleteWorkCalendar", "saveHoliday", "deleteHoliday"]) {
      const r = await request(app).post(`/api/work/${url}`).send({ Id: 1, x: 1 });
      expect(r.status).toBe(403);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("a role with settings add (not edit) can create but not edit a holiday", async () => {
    mockAcc = mockAccess({ modules: [["settings", "va"]] });
    database.executeStoredProcedure.mockResolvedValue(okRow);
    const create = await request(app).post("/api/work/saveHoliday").send({ HolidayDate: "2026-10-02", Name: "H" });
    expect(create.status).toBe(200);
    const edit = await request(app).post("/api/work/saveHoliday").send({ Id: 3, HolidayDate: "2026-10-02", Name: "H" });
    expect(edit.status).toBe(403);
  });

  it("day marks are open: reach is decided by the SP", async () => {
    mockAcc = mockAccess({ modules: [] });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ResponseCode: 403, ResponseMess: "Not your report" }]] });
    const r = await request(app).post("/api/work/saveDayMark").send({ UserId: 9, WorkDate: "2026-10-05", Part: "full", Kind: "leave" });
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("Not your report");
  });

  it("400s an empty payload on a write", async () => {
    mockAcc = mockAccess({ admin: true });
    const r = await request(app).post("/api/work/saveHoliday").send({});
    expect(r.status).toBe(400);
  });
});
