// Fail-closed guarantee (spec 2026-10-07 §3.2): every route declares the module
// and action it needs, open(), or requireAdmin, and the guard runs BEFORE the
// controller. A new endpoint without one fails here, before it can ship unguarded.
jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));

const express = require("express");
const { setupRoutes } = require("../../../src/config/routes");
const { requireModule, open, loadScope } = require("../../../src/middleware/permission");
const { verifyToken } = require("../../../src/middleware/auth");
const { requirePayload, allowEmptyPayload } = require("../../../src/middleware/payloadValidation");

// What may run before the guard: auth, body validation, and the multer wrapper
// (attachmentRoutes' handleUpload is not exported, so it is matched by name).
// Anything else ahead of the first guard is treated as a controller.
const PRE = new Set([verifyToken, loadScope, requirePayload, allowEmptyPayload]);
const isPre = (h) => PRE.has(h) || h.name === "handleUpload";

// Express 5 stores the mount path as a regexp, so nested routers cannot be
// joined with a path; a nested router is walked with the parent's prefix and
// its own route paths appended.
function walk(router, prefix = "") {
  return (router.stack || []).flatMap((layer) => {
    if (layer.route) {
      const handles = layer.route.stack.map((l) => l.handle);
      const firstMark = handles.findIndex((h) => h.access);
      return [{
        url: `${prefix}${layer.route.path}`,
        marks: handles.map((h) => h.access).filter(Boolean),
        // Every handle ahead of the first guard is a pre-handler, and something follows it.
        guardFirst: firstMark !== -1 && handles.slice(0, firstMark).every(isPre) && firstMark < handles.length - 1,
      }];
    }
    if (layer.handle && layer.handle.stack) return walk(layer.handle, prefix);
    return [];
  });
}

const mounted = [];
setupRoutes({
  use: (path, router) => mounted.push({ path, router }),
  get: () => {},
});
const routes = mounted.flatMap(({ path, router }) => walk(router, path));

it("finds the routers", () => {
  expect(routes.length).toBeGreaterThan(120); // 133 on 2026-10-07
});

it.each(routes.map((r) => [r.url, r]))("%s declares its access, before the controller", (url, r) => {
  expect(r.marks.length).toBeGreaterThan(0);
  expect(r.guardFirst).toBe(true);
});

describe("the walk itself", () => {
  const ctl = (req, res) => res.end();
  const synthetic = () => {
    const r = express.Router();
    r.post("/unguarded", ctl);
    r.post("/guardAfter", ctl, open());
    r.post("/ok", requireModule("leads", "view"), ctl);
    r.post("/guardBetween", ctl, open(), ctl);
    r.post("/okAfterPayload", requirePayload, open(), ctl);
    const inner = express.Router();
    inner.post("/nestedUnguarded", ctl);
    r.use("/sub", inner);
    return walk(r, "/x");
  };

  it("flags an unguarded route", () => {
    expect(synthetic().find((r) => r.url === "/x/unguarded").marks).toHaveLength(0);
  });
  it("flags a guard placed after the handler", () => {
    const r = synthetic().find((x) => x.url === "/x/guardAfter");
    expect(r.marks.length).toBeGreaterThan(0);
    expect(r.guardFirst).toBe(false);
  });
  it("flags a controller that runs before the guard, even with a handler after it", () => {
    const r = synthetic().find((x) => x.url === "/x/guardBetween");
    expect(r.marks.length).toBeGreaterThan(0);
    expect(r.guardFirst).toBe(false);
  });
  it("lets payload validation run ahead of the guard", () => {
    expect(synthetic().find((x) => x.url === "/x/okAfterPayload").guardFirst).toBe(true);
  });
  it("recurses into a nested router and flags its route", () => {
    const r = synthetic().find((x) => x.url.endsWith("/nestedUnguarded"));
    expect(r).toBeDefined();
    expect(r.marks).toHaveLength(0);
  });
  it("passes a correctly guarded route", () => {
    const r = synthetic().find((x) => x.url === "/x/ok");
    expect(r.marks.length).toBeGreaterThan(0);
    expect(r.guardFirst).toBe(true);
  });
});
