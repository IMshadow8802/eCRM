// /api/Card/* (the VisiScan app) and the guarded photo route, through setupRoutes with the real verifyToken.
let mockAcc;
jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));
jest.mock("../../../src/services/sessionService", () => ({ check: jest.fn(async () => ({ ok: true, userId: 7 })) }));
jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return { ...actual, loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next) };
});

const fs = require("fs");
const os = require("os");
const path = require("path");
const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");
const database = require("../../../src/config/database");
const { mockAccess } = require("../../helpers/mockAccess");

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const FRONT = `cards/${ID}/front-abc.jpg`;
let tmp, app, token;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cardroutes-"));
  jest.spyOn(process, "cwd").mockReturnValue(tmp);
  fs.mkdirSync(path.join(tmp, "uploads", "cards", ID), { recursive: true });
  fs.writeFileSync(path.join(tmp, "uploads", FRONT), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  app = express();
  app.use(express.json());
  require("../../../src/config/routes").setupRoutes(app);
  token = jwt.sign({ UserId: 7, CompId: 5, BranchId: 2, Sid: "s1" }, process.env.JWT_SECRET);
});
afterAll(() => { jest.restoreAllMocks(); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  mockAcc = mockAccess({ modules: [["cards", "vad", "Own"]] });
});

const cardRow = (over = {}) => ({ recordsets: [[{ TotalCount: 1 }], [{ Id: ID, FrontPath: FRONT, BackPath: null, ...over }]] });
const photo = (file, id = ID) => request(app).get(`/uploads/cards/${id}/${file}`).set("Authorization", `Bearer ${token}`);

describe("no token → 401", () => {
  it.each(["saveCard", "fetchCard", "deleteCard"])("/api/Card/%s", async (p) => {
    expect((await request(app).post(`/api/Card/${p}`).send({ id: ID })).status).toBe(401);
  });
  it("the photo route", async () => {
    expect((await request(app).get(`/uploads/cards/${ID}/front-abc.jpg`)).status).toBe(401);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

describe("module gates", () => {
  it("no cards module → 403 on every route", async () => {
    mockAcc = mockAccess({ modules: [["leads", "vaed"]] });
    for (const p of ["saveCard", "fetchCard", "deleteCard"]) {
      expect((await request(app).post(`/api/Card/${p}`).set("Authorization", `Bearer ${token}`).send({ id: ID })).status).toBe(403);
    }
    expect((await photo("front-abc.jpg")).status).toBe(403);
  });
  it("fetchCard accepts an empty body; deleteCard needs one", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ TotalCount: 0 }], []] });
    expect((await request(app).post("/api/Card/fetchCard").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).post("/api/Card/deleteCard").set("Authorization", `Bearer ${token}`).send({})).status).toBe(400);
  });
});

describe("Review Focus 2: the photo route", () => {
  it("the card's own file → 200 image/jpeg, private cache, scoped fetch", async () => {
    database.executeStoredProcedure.mockResolvedValue(cardRow());
    const res = await photo("front-abc.jpg");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchVisitingCards", expect.objectContaining({
      CompId: 5, Id: ID, UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]" }));
  });
  it("path traversal → 404", async () => {
    database.executeStoredProcedure.mockResolvedValue(cardRow());
    expect((await photo("..%2F..%2F..%2Fetc%2Fpasswd")).status).toBe(404);
  });
  it("a file name that is not the card's → 404", async () => {
    database.executeStoredProcedure.mockResolvedValue(cardRow());
    expect((await photo("front-other.jpg")).status).toBe(404);
  });
  it("a card the SP does not return → 404", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ TotalCount: 0 }], []] });
    expect((await photo("front-abc.jpg")).status).toBe(404);
  });
  it("a non-UUID id → 404 before any DB call", async () => {
    expect((await photo("front-abc.jpg", "not-a-uuid")).status).toBe(404);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
  it("the file is gone from disk → 404", async () => {
    database.executeStoredProcedure.mockResolvedValue(cardRow({ BackPath: `cards/${ID}/back-gone.jpg` }));
    expect((await photo("back-gone.jpg")).status).toBe(404);
  });
  it("a DB failure → 500", async () => {
    database.executeStoredProcedure.mockRejectedValue(new Error("down"));
    expect((await photo("front-abc.jpg")).status).toBe(500);
  });
});
