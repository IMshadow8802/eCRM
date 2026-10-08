// Role-module grid and my-access routes, through the real controllers with the DB mocked.
let mockAcc;
jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    req.user = { UserId: 7, CompId: 1, BranchId: 2 };
    next();
  },
}));
jest.mock("../../../src/middleware/permission", () => ({
  ...jest.requireActual("../../../src/middleware/permission"),
  loadScope: (req, res, next) =>
    require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next),
}));

const express = require("express");
const request = require("supertest");
const { mockAccess } = require("../../helpers/mockAccess");

const app = express();
app.use(express.json());
app.use("/api/auth", require("../../../src/routes/authRoutes"));
app.use("/api/user-groups", require("../../../src/routes/userGroupRoutes"));

const database = require("../../../src/config/database");
beforeEach(() => database.executeStoredProcedure.mockReset());

describe("role module + my-access routes", () => {
  it("fetchGroupModules returns the grid for an admin", async () => {
    mockAcc = mockAccess({ admin: true });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "ok", CanSeeSensitive: 0, IsAdmin: 0 }], [{ Module: "leads", CanView: 1 }]],
    });
    const r = await request(app).post("/api/user-groups/fetchGroupModules").send({ GroupId: 1 });
    expect(r.status).toBe(200);
    expect(r.body.data.modules).toEqual([{ Module: "leads", CanView: 1 }]);
  });

  it("saveGroupModules saves for an admin", async () => {
    mockAcc = mockAccess({ admin: true });
    database.executeStoredProcedure
      .mockResolvedValueOnce({ recordsets: [[{ Id: 1, ResponseCode: 200, ResponseMess: "Saved" }]] })
      .mockResolvedValue({ recordsets: [[]] }); // audit row
    const r = await request(app).post("/api/user-groups/saveGroupModules").send({ GroupId: 1, Modules: [] });
    expect(r.status).toBe(200);
    expect(database.executeStoredProcedure.mock.calls[0][0]).toBe("sp_SaveGroupModules");
  });

  it.each(["fetchGroupModules", "saveGroupModules"])("403s a non-admin on %s, before the controller", async (name) => {
    mockAcc = mockAccess({ modules: [["people", "vaed"]] });
    const r = await request(app).post(`/api/user-groups/${name}`).send({ GroupId: 1, Modules: [] });
    expect(r.status).toBe(403);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("fetchMyAccess answers any signed-in user with their own access", async () => {
    mockAcc = mockAccess({ modules: [["leads", "v", "Own"]] });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const r = await request(app).post("/api/auth/fetchMyAccess").send({});
    expect(r.status).toBe(200);
    expect(r.body.data.access.modules.leads.reach).toBe("Own");
    expect(r.body.data.permissions.totalMenuItems).toBe(0);
  });
});
