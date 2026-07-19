jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("socket.io", () => ({
  Server: jest.fn().mockImplementation(() => ({
    use: jest.fn(),
    on: jest.fn(),
    to: jest.fn(),
  })),
}));

const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const database = require("../../../src/config/database");
const {
  init,
  getIo,
  authMiddleware,
  onConnection,
} = require("../../../src/realtime/socket");
const {
  EVENT_WORKSPACE_JOIN,
  EVENT_WORKSPACE_LEAVE,
  rooms,
} = require("../../../src/realtime/contract");
const { CORS_ORIGINS } = require("../../../src/config/middleware");

const SECRET = process.env.JWT_SECRET;

function makeSocket(token) {
  return {
    handshake: { auth: { token } },
    data: {},
    join: jest.fn(),
    leave: jest.fn(),
    on: jest.fn(),
  };
}

function sign(claims, opts = {}) {
  return jwt.sign(
    { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: false, ...claims },
    SECRET,
    opts,
  );
}

// Wire a socket through onConnection and return its registered handlers.
function connect(user) {
  const socket = makeSocket();
  socket.data.user = user;
  onConnection(socket);
  const handlers = Object.fromEntries(socket.on.mock.calls);
  return { socket, handlers };
}

const memberRow = (code) => ({ recordsets: [[{ ResponseCode: code }]] });

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

describe("realtime auth middleware", () => {
  it("valid token attaches { UserId, CompId, IsAdmin } to socket.data.user", () => {
    const socket = makeSocket(sign({ IsAdmin: true }));
    const next = jest.fn();
    authMiddleware(socket, next);
    expect(next).toHaveBeenCalledWith(); // no error
    expect(socket.data.user).toEqual({ UserId: 7, CompId: 1, IsAdmin: true });
  });

  it("refuses a missing token", () => {
    const socket = makeSocket(undefined);
    const next = jest.fn();
    authMiddleware(socket, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe("unauthorized");
  });

  it("refuses an expired token", () => {
    const socket = makeSocket(sign({}, { expiresIn: -10 }));
    const next = jest.fn();
    authMiddleware(socket, next);
    expect(next.mock.calls[0][0].message).toBe("unauthorized");
  });

  it("refuses a garbage token", () => {
    const socket = makeSocket("not.a.jwt");
    const next = jest.fn();
    authMiddleware(socket, next);
    expect(next.mock.calls[0][0].message).toBe("unauthorized");
  });

  it("refuses a token signed with a different secret", () => {
    const bad = jwt.sign({ UserId: 7, CompId: 1 }, "some-other-secret");
    const socket = makeSocket(bad);
    const next = jest.fn();
    authMiddleware(socket, next);
    expect(next.mock.calls[0][0].message).toBe("unauthorized");
  });
});

describe("connection + workspace join authorization", () => {
  const user = { UserId: 7, CompId: 1, IsAdmin: false };

  it("auto-joins the user room on connection", () => {
    const { socket } = connect(user);
    expect(socket.join).toHaveBeenCalledWith(rooms.user(7));
  });

  it("active member joins the workspace room (SP returns 200)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(memberRow(200));
    const { socket, handlers } = connect(user);
    const ack = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: 5 }, ack);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchWorkspaceMembers",
      { WorkspaceId: 5, ActingUserId: 7, IsAdmin: 0, CompId: 1 },
    );
    expect(socket.join).toHaveBeenCalledWith(rooms.workspace(5));
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });

  it("non-member is refused (SP returns 403)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(memberRow(403));
    const { socket, handlers } = connect(user);
    const ack = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: 5 }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "forbidden" });
    expect(socket.join).not.toHaveBeenCalledWith(rooms.workspace(5));
  });

  it("pending-invite member is refused (SP 403s until InviteStatus='active')", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(memberRow(403));
    const { socket, handlers } = connect(user);
    const ack = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: 5 }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "forbidden" });
    expect(socket.join).not.toHaveBeenCalledWith(rooms.workspace(5));
  });

  it("admin joins a shared workspace (SP returns 200 for admin + non-personal)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(memberRow(200));
    const admin = { UserId: 99, CompId: 1, IsAdmin: true };
    const { socket, handlers } = connect(admin);
    const ack = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: 6 }, ack);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchWorkspaceMembers",
      { WorkspaceId: 6, ActingUserId: 99, IsAdmin: 1, CompId: 1 },
    );
    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(socket.join).toHaveBeenCalledWith(rooms.workspace(6));
  });

  it("THE INVARIANT: admin is REFUSED on another user's PERSONAL workspace", async () => {
    // sp_FetchWorkspaceMembers 403s on personal workspaces for everyone but
    // the owner — IsAdmin included. The join must honour that refusal.
    database.executeStoredProcedure.mockResolvedValueOnce(memberRow(403));
    const admin = { UserId: 99, CompId: 1, IsAdmin: true };
    const { socket, handlers } = connect(admin);
    const ack = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: 42 }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: "forbidden" });
    expect(socket.join).not.toHaveBeenCalledWith(rooms.workspace(42));
  });

  it.each([
    ["missing payload", undefined],
    ["missing workspaceId", {}],
    ["non-numeric", { workspaceId: "abc" }],
    ["zero", { workspaceId: 0 }],
    ["negative", { workspaceId: -3 }],
    ["fractional", { workspaceId: 1.5 }],
  ])("malformed workspaceId refused without a DB hit (%s)", async (_n, payload) => {
    const { handlers } = connect(user);
    const ack = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN](payload, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "invalid workspaceId" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("accepts a numeric-string workspaceId (Number coercion)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(memberRow(200));
    const { handlers } = connect(user);
    const ack = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: "5" }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });

  it("rate-limits join attempts (max 30/min per socket)", async () => {
    database.executeStoredProcedure.mockResolvedValue(memberRow(200));
    const { handlers } = connect(user);
    for (let i = 0; i < 30; i += 1) {
      const ack = jest.fn();
      await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: 5 }, ack);
      expect(ack).toHaveBeenCalledWith({ ok: true });
    }
    const ack31 = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: 5 }, ack31);
    expect(ack31).toHaveBeenCalledWith({ ok: false, error: "rate limited" });
    // 31st attempt never reached the DB
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(30);
  });

  it("answers { ok: false } when the DB check throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const { handlers } = connect(user);
    const ack = jest.fn();
    await handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: 5 }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "join failed" });
  });

  it("does not crash when no ack callback is supplied", async () => {
    const { handlers } = connect(user);
    await expect(
      handlers[EVENT_WORKSPACE_JOIN]({ workspaceId: "abc" }, undefined),
    ).resolves.toBeUndefined();
  });

  it("workspace:leave leaves the room without auth", () => {
    const { socket, handlers } = connect(user);
    handlers[EVENT_WORKSPACE_LEAVE]({ workspaceId: 5 });
    expect(socket.leave).toHaveBeenCalledWith(rooms.workspace(5));
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("workspace:leave ignores malformed workspaceId", () => {
    const { socket, handlers } = connect(user);
    handlers[EVENT_WORKSPACE_LEAVE]({ workspaceId: "nope" });
    handlers[EVENT_WORKSPACE_LEAVE](undefined);
    expect(socket.leave).not.toHaveBeenCalled();
  });
});

describe("init / getIo", () => {
  it("boots socket.io on the http server with the Express CORS allowlist", () => {
    const httpServer = {};
    const io = init(httpServer);

    expect(Server).toHaveBeenCalledWith(httpServer, {
      cors: { origin: CORS_ORIGINS, credentials: true },
    });
    expect(io.use).toHaveBeenCalledWith(authMiddleware);
    expect(io.on).toHaveBeenCalledWith("connection", onConnection);
    expect(getIo()).toBe(io);
  });
});
