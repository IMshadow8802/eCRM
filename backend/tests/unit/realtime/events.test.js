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

const { emitToWorkspace, emitToUser } = require("../../../src/realtime/events");
const { init } = require("../../../src/realtime/socket");
const {
  EVENT_INVALIDATE,
  SCOPES,
  rooms,
} = require("../../../src/realtime/contract");

describe("before init (socket server not initialized)", () => {
  it("emitToWorkspace is a no-op and does not crash", () => {
    expect(() =>
      emitToWorkspace(5, SCOPES.TASK_LIST, { workspaceId: 5 }),
    ).not.toThrow();
  });

  it("emitToUser is a no-op and does not crash", () => {
    expect(() => emitToUser(7, SCOPES.NOTIFICATIONS)).not.toThrow();
  });
});

describe("after init (mocked io)", () => {
  let io;
  let emit;

  beforeAll(() => {
    io = init({});
  });

  beforeEach(() => {
    emit = jest.fn();
    io.to.mockReturnValue({ emit });
  });

  it("emitToWorkspace targets the workspace room with { scope, ...extra }", () => {
    emitToWorkspace(5, SCOPES.TASK_DETAIL, { workspaceId: 5, taskId: 11 });
    expect(io.to).toHaveBeenCalledWith(rooms.workspace(5));
    expect(emit).toHaveBeenCalledWith(EVENT_INVALIDATE, {
      scope: SCOPES.TASK_DETAIL,
      workspaceId: 5,
      taskId: 11,
    });
  });

  it("emitToWorkspace with no extra sends only { scope }", () => {
    emitToWorkspace(5, SCOPES.WORKSPACES);
    expect(io.to).toHaveBeenCalledWith(rooms.workspace(5));
    expect(emit).toHaveBeenCalledWith(EVENT_INVALIDATE, {
      scope: SCOPES.WORKSPACES,
    });
  });

  it("emitToUser targets the user room", () => {
    emitToUser(7, SCOPES.NOTIFICATIONS);
    expect(io.to).toHaveBeenCalledWith(rooms.user(7));
    expect(emit).toHaveBeenCalledWith(EVENT_INVALIDATE, {
      scope: SCOPES.NOTIFICATIONS,
    });
  });

  it("skips silently when the target id is falsy", () => {
    emitToWorkspace(null, SCOPES.TASK_LIST);
    emitToUser(undefined, SCOPES.WORKSPACES);
    expect(io.to).not.toHaveBeenCalled();
  });
});
