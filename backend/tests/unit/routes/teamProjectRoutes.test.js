// Regression, 2026-10-07 audit S2: the Teams and Projects write endpoints had
// no gate. sp_SaveTeam pushes its roster into every linked project workspace,
// so any employee could POST saveTeam with their own id added and become a
// member of any project workspace. The screens are granted to Owner, Admin and
// HR Manager — HR is not IsAdmin — so the gate is the menu grant
// (sp_CheckMenuRight), not requireAdmin. Reads stay open: task forms list
// teams and projects for everyone.

let mockScope;

jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    req.user = { UserId: 7, CompId: 1, BranchId: 2 };
    next();
  },
}));

jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return {
    ...actual,
    loadScope: (req, res, next) => {
      req.scope = mockScope;
      next();
    },
  };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/teamController", () => ({
  save: hit("saveTeam"),
  fetch: hit("fetchTeams"),
  delete: hit("deleteTeam"),
}));
jest.mock("../../../src/controllers/projectController", () => ({
  save: hit("saveProject"),
  fetch: hit("fetchProjects"),
  delete: hit("deleteProject"),
}));

const express = require("express");
const request = require("supertest");
const database = require("../../../src/config/database");

const app = express();
app.use(express.json());
app.use("/api/teams", require("../../../src/routes/teamRoutes"));
app.use("/api/projects", require("../../../src/routes/projectRoutes"));

const grant = (allowed) =>
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Allowed: allowed ? 1 : 0 }]] });

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  mockScope = { isAdmin: false, branchIds: [2] };
});

describe("Teams/Projects write gate", () => {
  it.each([
    ["/api/teams/saveTeam", { Id: 0, Name: "T" }, "/teams", "add"],
    ["/api/teams/saveTeam", { Id: 4, Name: "T" }, "/teams", "edit"],
    ["/api/teams/deleteTeam", { Id: 4 }, "/teams", "delete"],
    ["/api/projects/saveProject", { Id: 0, Name: "P" }, "/projects", "add"],
    ["/api/projects/saveProject", { Id: 9, Name: "P" }, "/projects", "edit"],
    ["/api/projects/deleteProject", { Id: 9 }, "/projects", "delete"],
  ])("%s %j checks %s:%s and 403s without the grant", async (path, body, route, right) => {
    grant(false);
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(403);
    expect(r.body.hit).toBeUndefined();
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_CheckMenuRight",
      expect.objectContaining({ Route: route, Right: right, UserId: 7, CompId: 1 }),
    );
  });

  it("lets HR (granted, not admin) save a team", async () => {
    grant(true);
    const r = await request(app).post("/api/teams/saveTeam").send({ Id: 4, Name: "T" });
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe("saveTeam");
  });

  it("keeps the lists readable without a grant", async () => {
    const t = await request(app).post("/api/teams/fetchTeams").send({});
    const p = await request(app).post("/api/projects/fetchProjects").send({});
    expect([t.body.hit, p.body.hit]).toEqual(["fetchTeams", "fetchProjects"]);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});
