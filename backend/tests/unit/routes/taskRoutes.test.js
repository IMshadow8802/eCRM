// Route wiring for the task API: every path reaches its controller method.
// Any controller property resolves to a stub that echoes its own name, so the
// test needs no per-route mock and a renamed/missing handler fails loudly.
let mockAcc;

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
jest.mock("../../../src/controllers/taskController", () => {
  const stubs = {};
  return new Proxy(
    {},
    {
      get: (_t, name) => {
        if (typeof name !== "string" || name === "then") return undefined;
        stubs[name] ??= jest.fn((req, res) => res.status(200).json({ hit: name }));
        return stubs[name];
      },
    },
  );
});

const { mockAccess } = require("../../helpers/mockAccess");
mockAcc = mockAccess({ modules: [["tasks"]] });

const express = require("express");
const request = require("supertest");
const taskRoutes = require("../../../src/routes/taskRoutes");

const app = express();
app.use(express.json());
app.use("/api/tasks", taskRoutes);

describe("taskRoutes", () => {
  it.each([
    ["claimTask", "claim"],
    ["saveTask", "save"],
    ["moveTaskColumn", "moveColumn"],
    ["fetchTasks", "fetch"],
    ["deleteTask", "delete"],
    ["bulkDeleteTasks", "bulkDelete"],
    ["addTaskComment", "addComment"],
    ["getTaskComments", "getComments"],
    ["deleteTaskComment", "deleteComment"],
    ["pinTaskComment", "pinComment"],
    ["markTaskCommentRead", "markCommentRead"],
    ["addTaskDependency", "addDependency"],
    ["removeTaskDependency", "removeDependency"],
  ])("POST /%s reaches taskController.%s", async (path, method) => {
    const r = await request(app).post(`/api/tasks/${path}`).send({});
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(method);
  });

  it("404s an unknown path and GET is not routed", async () => {
    expect((await request(app).post("/api/tasks/nope").send({})).status).toBe(404);
    expect((await request(app).get("/api/tasks/claimTask")).status).toBe(404);
  });
});

describe("taskRoutes access", () => {
  it("403s a role without the tasks module and never reaches the controller", async () => {
    mockAcc = mockAccess({ modules: [["leads", "vaed"]] });
    const r = await request(app).post("/api/tasks/saveTask").send({});
    mockAcc = mockAccess({ modules: [["tasks"]] });
    expect(r.status).toBe(403);
    expect(require("../../../src/controllers/taskController").save).not.toHaveBeenCalled();
  });
});
