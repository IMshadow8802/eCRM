jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const notificationController = require("../../../src/controllers/notificationController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: false },
    body: {},
    ...overrides,
  };
}

const spResult = (rows) => ({ recordsets: [rows] });

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

describe("notificationController.fetch", () => {
  it("returns notifications + unreadCount + pagination", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Notifications retrieved",
          TotalRecords: 1,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 25,
          UnreadCount: 3,
          Id: 10,
          UserId: 7,
          Type: "task_assigned",
          EntityType: "task",
          EntityId: 100,
          ActorUserId: 3,
          ActorName: "Raaj",
          Title: "New task",
          Body: "Do X",
          IsRead: false,
          ReadAt: null,
          CreatedDate: "2026-04-18T00:00:00Z",
        },
      ]),
    );

    const req = baseReq({ body: { UnreadOnly: true } });
    const res = mockRes();
    await notificationController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchNotifications",
      expect.objectContaining({ UserId: 7, UnreadOnly: 1, PageNumber: 1, PageSize: 25 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json.data.notifications).toHaveLength(1);
    expect(json.data.unreadCount).toBe(3);
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 25,
      totalRecords: 1,
      totalPages: 1,
    });
  });

  it("defaults UnreadOnly to 0 when not provided", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "No notifications",
          TotalRecords: 0,
          TotalPages: 0,
          CurrentPage: 1,
          PageSize: 25,
          UnreadCount: 0,
          Id: null,
        },
      ]),
    );
    const req = baseReq();
    const res = mockRes();
    await notificationController.fetch(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchNotifications",
      expect.objectContaining({ UnreadOnly: 0 }),
    );
    expect(res.json.mock.calls[0][0].data.notifications).toHaveLength(0);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await notificationController.fetch(baseReq(), mockRes());
    spy.mockRestore();
  });
});

describe("notificationController.markRead", () => {
  it("rejects missing Id with 400", async () => {
    const req = baseReq({ body: {} });
    const res = mockRes();
    await notificationController.markRead(req, res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Marked as read" }]),
    );
    const req = baseReq({ body: { Id: 42 } });
    const res = mockRes();
    await notificationController.markRead(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_MarkNotificationRead",
      { Id: 42, UserId: 7 },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { Id: 42 } });
    const res = mockRes();
    await notificationController.markRead(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("NOTIFICATION_MARK_READ_ERROR");
    spy.mockRestore();
  });
});

describe("notificationController.markAllRead", () => {
  it("returns updatedCount on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Marked 5 as read", UpdatedCount: 5 }]),
    );
    const req = baseReq();
    const res = mockRes();
    await notificationController.markAllRead(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_MarkAllNotificationsRead",
      { UserId: 7 },
    );
    expect(res.json.mock.calls[0][0].data.updatedCount).toBe(5);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await notificationController.markAllRead(baseReq(), mockRes());
    spy.mockRestore();
  });
});
