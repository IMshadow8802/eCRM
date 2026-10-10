// The four partner endpoints and who may reach them. fetchPartners is open()
// at the route (its handler gates leads/partners view); the rest need `partners`.
let mockAcc;

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => { req.user = { UserId: 7, CompId: 5, BranchId: 2 }; next(); },
}));
jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return { ...actual, loadScope: (req, res, next) => require("../../helpers/mockAccess").loadScopeWith(() => mockAcc)(req, res, next) };
});
const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/partnerController", () => ({
  fetchPartners: hit("fetchPartners"), savePartner: hit("savePartner"),
  fetchCommissions: hit("fetchCommissions"), setCommissionStatus: hit("setCommissionStatus"),
}));

const { mockAccess } = require("../../helpers/mockAccess");
const express = require("express");
const request = require("supertest");
const app = express();
app.use(express.json());
app.use("/api/partners", require("../../../src/routes/partnerRoutes"));
const post = (p, body = { x: 1 }) => request(app).post(`/api/partners/${p}`).send(body);

describe("partnerRoutes", () => {
  it("a partners editor reaches all four", async () => {
    mockAcc = mockAccess({ modules: [["partners", "vaed"]] });
    for (const h of ["fetchPartners", "savePartner", "fetchCommissions", "setCommissionStatus"]) {
      expect((await post(h)).body.hit).toBe(h);
    }
  });
  it("a leads-only caller reaches fetchPartners (open) but not the rest", async () => {
    mockAcc = mockAccess({ modules: [["leads", "v"]] });
    expect((await post("fetchPartners", {})).status).toBe(200);
    for (const h of ["savePartner", "fetchCommissions", "setCommissionStatus"]) expect((await post(h)).status).toBe(403);
  });
  it("setCommissionStatus needs partners edit, and the old routes are gone", async () => {
    mockAcc = mockAccess({ modules: [["partners", "v"]] });
    expect((await post("setCommissionStatus")).status).toBe(403);
    for (const h of ["fetchPartnerPicker", "markCommissionDue", "markCommissionPaid", "savePartnerSetting"]) {
      expect((await post(h)).status).toBe(404);
    }
  });
});
