// Regression, 2026-10-07 audit S2: the Teams and Projects write endpoints had
// no gate. sp_SaveTeam pushes its roster into every linked project workspace,
// so any employee could POST saveTeam with their own id added and become a
// member of any project workspace. HR is not IsAdmin, so the gate is the
// teams / projects module (requireModule), not requireAdmin. Reads stay open: task forms list
// teams and projects for everyone.


let mockAcc;

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
    loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next),
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

const { mockAccess } = require("../../helpers/mockAccess");
mockAcc = mockAccess({ modules: [] });

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
  mockAcc = mockAccess({ modules: [["leads", "vaed"]] }); // Sales Executive: no teams/projects
});

describe("Teams/Projects write gate", () => {
  it.each([
    ["/api/teams/saveTeam", { Id: 0, Name: "T" }],
    ["/api/teams/saveTeam", { Id: 4, Name: "T" }],
    ["/api/teams/deleteTeam", { Id: 4 }],
    ["/api/projects/saveProject", { Id: 0, Name: "P" }],
    ["/api/projects/saveProject", { Id: 9, Name: "P" }],
    ["/api/projects/deleteProject", { Id: 9 }],
  ])("%s %j 403s without the module, with no DB call", async (path, body) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(403);
    expect(r.body.hit).toBeUndefined();
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("lets HR (teams module, not admin) save and delete a team, by right", async () => {
    mockAcc = mockAccess({ modules: [["teams", "vae"]] });
    expect((await request(app).post("/api/teams/saveTeam").send({ Id: 4, Name: "T" })).body.hit).toBe("saveTeam");
    expect((await request(app).post("/api/teams/saveTeam").send({ Id: 0, Name: "T" })).status).toBe(200);
    expect((await request(app).post("/api/teams/deleteTeam").send({ Id: 4 })).status).toBe(403); // no d right
    mockAcc = mockAccess({ modules: [["teams", "vaed"]] });
    expect((await request(app).post("/api/teams/deleteTeam").send({ Id: 4 })).status).toBe(200);
  });

  it("gates projects on the projects module, not teams", async () => {
    mockAcc = mockAccess({ modules: [["teams", "vaed"]] });
    expect((await request(app).post("/api/projects/saveProject").send({ Id: 0, Name: "P" })).status).toBe(403);
    mockAcc = mockAccess({ modules: [["projects", "vaed"]] });
    expect((await request(app).post("/api/projects/saveProject").send({ Id: 0, Name: "P" })).status).toBe(200);
    expect((await request(app).post("/api/projects/deleteProject").send({ Id: 9 })).status).toBe(200);
  });

  it("lets an admin write both", async () => {
    mockAcc = mockAccess({ admin: true });
    expect((await request(app).post("/api/teams/saveTeam").send({ Id: 4, Name: "T" })).status).toBe(200);
    expect((await request(app).post("/api/projects/deleteProject").send({ Id: 9 })).status).toBe(200);
  });

  it("keeps the lists readable without a grant", async () => {
    const t = await request(app).post("/api/teams/fetchTeams").send({});
    const p = await request(app).post("/api/projects/fetchProjects").send({});
    expect([t.body.hit, p.body.hit]).toEqual(["fetchTeams", "fetchProjects"]);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});
