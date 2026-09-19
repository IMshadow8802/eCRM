// The controller suite tests the handlers; this tests that they are reachable,
// that every route sits behind verifyToken + loadScope, and that requirePayload
// guards everything but the list.

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => { req.user = { UserId: 7, CompId: 5, BranchId: 2 }; next(); },
}));
jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return { ...actual, loadScope: (req, res, next) => { req.scope = { isAdmin: false, branchIds: [2], ownerIds: [7] }; next(); } };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name, scoped: Boolean(req.scope) }));
jest.mock("../../../src/controllers/quotationController", () => ({
  save: hit("save"), fetch: hit("fetch"), detail: hit("detail"),
  finalise: hit("finalise"), revise: hit("revise"), reject: hit("reject"), remove: hit("remove"),
  ensureProfile: hit("ensureProfile"), saveProfile: hit("saveProfile"),
}));

const express = require("express");
const request = require("supertest");
const quotationRoutes = require("../../../src/routes/quotationRoutes");

const app = express();
app.use(express.json());
app.use("/api/quotations", quotationRoutes);

const ROUTES = [
  ["saveQuotation", { LeadId: 9 }, "save"],
  ["fetchQuotations", {}, "fetch"],
  ["fetchQuotationDetail", { QuotationId: 4 }, "detail"],
  ["finaliseQuotation", { QuotationId: 4 }, "finalise"],
  ["reviseQuotation", { QuotationId: 4 }, "revise"],
  ["rejectQuotation", { QuotationId: 4 }, "reject"],
  ["deleteQuotation", { QuotationId: 4 }, "remove"],
  ["ensureQuoteProfile", { LeadId: 9 }, "ensureProfile"],
  ["saveQuoteProfile", { LeadId: 9, CompanyName: "x" }, "saveProfile"],
];

describe("quotationRoutes", () => {
  it.each(ROUTES)("routes %s to its handler, scoped", async (path, body, handler) => {
    const r = await request(app).post(`/api/quotations/${path}`).send(body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ hit: handler, scoped: true });
  });

  it("requires a payload on every route but the list", async () => {
    for (const [path] of ROUTES.filter(([p]) => p !== "fetchQuotations")) {
      expect((await request(app).post(`/api/quotations/${path}`).send({})).status).toBe(400);
    }
    expect((await request(app).post("/api/quotations/fetchQuotations").send({})).status).toBe(200);
  });

  it("answers only POST", async () => {
    expect((await request(app).get("/api/quotations/fetchQuotations")).status).toBe(404);
  });
});
