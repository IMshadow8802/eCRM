// backend/tests/unit/routes/ticketRoutes.test.js
//
// The ticket route table after 086: the stage move is gone with the pipeline
// engine, status changes go through setTicketStatus (+ four shortcuts), and
// transfer / bulk transfer / escalate arrive from the lead playbook. The
// controller suite tests the handlers; this locks the table down — every
// route reachable, the retired one not, the exact list in order, and which
// routes tolerate an empty body.

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    req.user = { UserId: 7, CompId: 5, BranchId: 2 };
    next();
  },
}));

jest.mock("../../../src/middleware/permission", () => {
  const actual = jest.requireActual("../../../src/middleware/permission");
  return {
    ...actual,
    loadScope: (req, res, next) => {
      req.scope = { isAdmin: false, hierarchyLevel: 3, dataScope: "Branch", branchIds: [2] };
      next();
    },
  };
});

const hit = (name) => jest.fn((req, res) => res.status(200).json({ success: true, hit: name }));
jest.mock("../../../src/controllers/ticketController", () => ({
  save: hit("save"),
  fetch: hit("fetch"),
  detail: hit("detail"),
  setStatus: hit("setStatus"),
  resolve: hit("resolve"),
  close: hit("close"),
  reject: hit("reject"),
  reopen: hit("reopen"),
  transfer: hit("transfer"),
  bulkTransfer: hit("bulkTransfer"),
  escalate: hit("escalate"),
  escalationTargets: hit("escalationTargets"),
  delete: hit("delete"),
}));

const express = require("express");
const request = require("supertest");
const ticketRoutes = require("../../../src/routes/ticketRoutes");

const app = express();
app.use(express.json());
app.use("/api/tickets", ticketRoutes);

describe("ticketRoutes", () => {
  // The Contracts table, verbatim and in order. A route added or dropped
  // anywhere in this file has to come through here.
  it("exposes exactly the contracted routes, in order", () => {
    const paths = ticketRoutes.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(paths).toEqual([
      "/saveTicket",
      "/fetchTickets",
      "/fetchTicketDetail",
      "/setTicketStatus",
      "/resolveTicket",
      "/closeTicket",
      "/rejectTicket",
      "/reopenTicket",
      "/transferTicket",
      "/bulkTransferTickets",
      "/escalateTicket",
      "/fetchEscalationTargets",
      "/deleteTicket",
    ]);
  });

  it.each([
    ["/api/tickets/saveTicket", { CustomerId: 31, Subject: "x" }, "save"],
    ["/api/tickets/fetchTickets", { PageNumber: 1 }, "fetch"],
    ["/api/tickets/fetchTicketDetail", { TicketId: 1 }, "detail"],
    ["/api/tickets/setTicketStatus", { TicketId: 1, StatusId: 62 }, "setStatus"],
    ["/api/tickets/resolveTicket", { TicketId: 1, ResolutionId: 8, Remarks: "x" }, "resolve"],
    ["/api/tickets/closeTicket", { TicketId: 1 }, "close"],
    ["/api/tickets/rejectTicket", { TicketId: 1, Remarks: "x" }, "reject"],
    ["/api/tickets/reopenTicket", { TicketId: 1, Remarks: "x" }, "reopen"],
    ["/api/tickets/transferTicket", { TicketId: 1, ToUserId: 18, ReasonId: 36, Remarks: "x" }, "transfer"],
    ["/api/tickets/bulkTransferTickets", { TicketIds: [1], ToUserId: 18, ReasonId: 36, Remarks: "x" }, "bulkTransfer"],
    ["/api/tickets/escalateTicket", { TicketId: 1, ToUserId: 16, Remarks: "x" }, "escalate"],
    ["/api/tickets/fetchEscalationTargets", { ForUserId: 18 }, "escalationTargets"],
    ["/api/tickets/deleteTicket", { Id: 1 }, "delete"],
  ])("routes %s to the %s handler", async (path, body, handler) => {
    const r = await request(app).post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.body.hit).toBe(handler);
  });

  // 086 drops sp_MoveTicketStage with the pipeline engine.
  it("no longer exposes moveTicketStage", async () => {
    const r = await request(app).post("/api/tickets/moveTicketStage").send({ TicketId: 1, StageId: 3 });
    expect(r.status).toBe(404);
  });

  it("requires a payload on every route but the two reads that may ask for everything", async () => {
    for (const path of [
      "/api/tickets/saveTicket", "/api/tickets/fetchTicketDetail", "/api/tickets/setTicketStatus",
      "/api/tickets/resolveTicket", "/api/tickets/closeTicket", "/api/tickets/rejectTicket",
      "/api/tickets/reopenTicket", "/api/tickets/transferTicket", "/api/tickets/bulkTransferTickets",
      "/api/tickets/escalateTicket", "/api/tickets/deleteTicket",
    ]) {
      expect((await request(app).post(path).send({})).status).toBe(400);
    }
    // "Everything I can see" and "my own chain" are legitimate empty asks.
    expect((await request(app).post("/api/tickets/fetchTickets").send({})).status).toBe(200);
    expect((await request(app).post("/api/tickets/fetchEscalationTargets").send({})).status).toBe(200);
  });
});
