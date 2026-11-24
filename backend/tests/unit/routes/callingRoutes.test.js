// Who may reach the calling routes (149): managers need `calling`, callers need `leads` add.
let mockAcc;
jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => { req.user = { UserId: 7, CompId: 5, BranchId: 2 }; next(); },
}));
jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return { ...actual, loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next) };
});
const MANAGER = ["fetchLists", "saveList", "deleteList", "saveCallers", "importContacts", "addContact", "fetchContacts",
  "contactHistory", "assign", "recall", "setState"];
const CALLER = ["myList", "saveResult", "convert", "undoResult"];
const hit = (name) => jest.fn((req, res) => res.status(200).json({ hit: name }));
jest.mock("../../../src/controllers/callingController", () => Object.fromEntries(
  ["fetchLists", "saveList", "deleteList", "saveCallers", "importContacts", "addContact", "fetchContacts", "contactHistory",
    "assign", "recall", "setState"].map((n) => [n, hit(n)])));
jest.mock("../../../src/controllers/callingCallerController", () => Object.fromEntries(
  ["myList", "saveResult", "convert", "undoResult"].map((n) => [n, hit(n)])));

const { mockAccess } = require("../../helpers/mockAccess");
const express = require("express");
const request = require("supertest");
const app = express();
app.use(express.json());
app.use("/api/calling", require("../../../src/routes/callingRoutes"));
const post = (p, body = { x: 1 }) => request(app).post(`/api/calling/${p}`).send(body);

describe("callingRoutes", () => {
  it("a salesperson (leads V/A/E, no calling) gets 403 on every manager route and reaches the caller routes", async () => {
    mockAcc = mockAccess({ modules: [["leads", "vae", "Own"]] });
    for (const p of MANAGER) expect((await post(p)).status).toBe(403);
    for (const p of CALLER) expect((await post(p)).body.hit).toBe(p);
    expect((await post("myList", {})).status).toBe(200);
  });
  it("a view-only list manager gets the lists and nothing else", async () => {
    mockAcc = mockAccess({ modules: [["calling", "v"]] });
    expect((await post("fetchLists", {})).status).toBe(200);
    for (const p of ["fetchContacts", "assign", "importContacts", "saveList", "deleteList"]) expect((await post(p)).status).toBe(403);
  });
  it("a list manager with calling but no leads add gets 403 on the caller routes", async () => {
    mockAcc = mockAccess({ modules: [["calling", "vaed"], ["leads", "v", "Office"]] });
    for (const p of CALLER) expect((await post(p)).status).toBe(403);
    for (const p of MANAGER.filter((x) => x !== "deleteList")) expect((await post(p)).body.hit).toBe(p);
  });
  it("saveList needs edit for an existing list and add for a new one", async () => {
    mockAcc = mockAccess({ modules: [["calling", "va"]] });
    expect((await post("saveList", { Name: "x" })).status).toBe(200);
    expect((await post("saveList", { Id: 4, Name: "x" })).status).toBe(403);
  });
  it("deleting a list is admin-only, even with calling delete", async () => {
    mockAcc = mockAccess({ modules: [["calling", "vaed"]] });
    expect((await post("deleteList")).status).toBe(403);
    mockAcc = mockAccess({ admin: true });
    expect((await post("deleteList")).body.hit).toBe("deleteList");
  });

  it("write routes need a body", async () => {
    mockAcc = mockAccess({ admin: true });
    expect((await post("assign", {})).status).toBe(400);
    expect((await post("saveResult", {})).status).toBe(400);
  });
});
