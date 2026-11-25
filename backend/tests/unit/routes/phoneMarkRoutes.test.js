let mockAcc;
jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => { req.user = { UserId: 7, CompId: 5, BranchId: 2 }; next(); },
}));
jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return { ...actual, loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next) };
});
const hit = (name) => jest.fn((req, res) => res.status(200).json({ hit: name }));
jest.mock("../../../src/controllers/phoneMarkController", () => ({ fetch: hit("fetch"), set: hit("set"), clear: hit("clear") }));

const { mockAccess } = require("../../helpers/mockAccess");
const express = require("express");
const request = require("supertest");
const app = express();
app.use(express.json());
app.use("/api/phoneMark", require("../../../src/routes/phoneMarkRoutes"));
const post = (p, body = { x: 1 }) => request(app).post(`/api/phoneMark/${p}`).send(body);

describe("phoneMarkRoutes", () => {
  it("a non-admin with calling edit gets the list, not clear", async () => {
    mockAcc = mockAccess({ modules: [["calling", "ve"]] });
    expect((await post("fetch", {})).status).toBe(200);
    expect((await post("clear")).status).toBe(403);
  });
  it("a salesperson can neither read the list nor set a mark (callers mark dnc only through a call result)", async () => {
    mockAcc = mockAccess({ modules: [["leads", "vae", "Own"], ["customers", "vae"], ["complaints", "vae"]] });
    expect((await post("fetch")).status).toBe(403);
    expect((await post("set")).status).toBe(403);
  });
  it("a calling-edit user sets a mark; calling view alone does not", async () => {
    mockAcc = mockAccess({ modules: [["calling", "ve"]] });
    expect((await post("set")).body.hit).toBe("set");
    mockAcc = mockAccess({ modules: [["calling", "v"]] });
    expect((await post("set")).status).toBe(403);
  });
  it("an admin clears", async () => {
    mockAcc = mockAccess({ admin: true });
    expect((await post("clear")).body.hit).toBe("clear");
  });
});
