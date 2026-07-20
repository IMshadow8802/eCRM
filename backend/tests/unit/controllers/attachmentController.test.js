jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const attachmentController = require("../../../src/controllers/attachmentController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: { branchIds: [2], ownerIds: null, isAdmin: false },
    body: {},
    file: null,
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

// Entity-access guard lookups. lead/ticket route through their detail SP +
// canSeeRecord; task routes through sp_CheckTaskPermission.
function mockLeadLookup(lead) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [lead ? [lead] : [], [], []],
  });
}
function mockTicketLookup(ticket) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ticket ? [ticket] : [], [], [], []],
  });
}
function mockTaskPermission(allowed) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [[{ Allowed: allowed, Reason: "test" }]],
  });
}

describe("attachmentController.save", () => {
  const file = {
    originalname: "error.png",
    filename: "abc-123.png",
    size: 1024,
    mimetype: "image/png",
    path: "/app/uploads/ticket/abc-123.png",
  };

  it("400s when no file is present", async () => {
    const res = mockRes();
    await attachmentController.save(baseReq({ body: { Entity: "ticket", EntityId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s on invalid Entity/EntityId", async () => {
    const res = mockRes();
    await attachmentController.save(baseReq({ file, body: { Entity: "nope", EntityId: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("inserts metadata and injects CompId/UploadedBy", async () => {
    mockTicketLookup({ Id: 42, BranchId: 2, AssignedTo: 3, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 201, ResponseMess: "Attachment saved", AttachmentId: 9 }]],
    });
    const res = mockRes();
    await attachmentController.save(baseReq({ file, body: { Entity: "ticket", EntityId: 42 } }), res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveAttachment",
      expect.objectContaining({
        Id: 0, CompId: 5, Entity: "ticket", EntityId: 42,
        FileName: "error.png", StoredName: "abc-123.png",
        FileSize: 1024, MimeType: "image/png", UploadedBy: 7,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.attachmentId).toBe(9);
  });

  it("500s (and does not crash) when the SP throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("db down"));
    const res = mockRes();
    await attachmentController.save(baseReq({ file, body: { Entity: "task", EntityId: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // REGRESSION: save used to accept any Entity/EntityId within the company —
  // including files onto tasks in someone else's PERSONAL workspace.
  it("403s uploading to a task the workspace SP denies (no admin bypass)", async () => {
    mockTaskPermission(false); // e.g. personal workspace, caller not the owner
    const res = mockRes();
    const req = baseReq({
      scope: { branchIds: [2], ownerIds: null, isAdmin: true },
      file,
      body: { Entity: "task", EntityId: 3 },
    });
    await attachmentController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_CheckTaskPermission",
      expect.objectContaining({ TaskId: 3, UserId: 7, Action: "edit_fields", IsAdmin: 1, CompId: 5 }),
    );
  });

  it("saves to a task the workspace SP allows", async () => {
    mockTaskPermission(true);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 201, ResponseMess: "Attachment saved", AttachmentId: 10 }]],
    });
    const res = mockRes();
    await attachmentController.save(baseReq({ file, body: { Entity: "task", EntityId: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("403s uploading to a lead outside the caller's scope", async () => {
    mockLeadLookup({ Id: 8, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await attachmentController.save(baseReq({ file, body: { Entity: "lead", EntityId: 8 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("500s ATTACHMENT_SAVE_ERROR when the insert SP throws after the guard passes", async () => {
    mockTaskPermission(true);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("insert failed"));
    const res = mockRes();
    await attachmentController.save(baseReq({ file, body: { Entity: "task", EntityId: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("ATTACHMENT_SAVE_ERROR");
  });

  it("surfaces the SP's error status and returns null data", async () => {
    mockTicketLookup({ Id: 42, BranchId: 2, AssignedTo: 7, CreatedBy: 7 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 404, ResponseMess: "Parent record not found" }]],
    });
    const res = mockRes();
    await attachmentController.save(baseReq({ file, body: { Entity: "ticket", EntityId: 42 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });
});

describe("attachmentController.fetch", () => {
  it("400s when Id:0 without Entity/EntityId", async () => {
    const res = mockRes();
    await attachmentController.fetch(baseReq({ body: { Id: 0 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns a list scoped to CompId after checking the parent record", async () => {
    mockLeadLookup({ Id: 8, BranchId: 2, OwnerId: 3, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, Entity: "lead", EntityId: 8, FileName: "x.pdf", StoredName: "u.pdf" }]],
    });
    const res = mockRes();
    await attachmentController.fetch(baseReq({ body: { Id: 0, Entity: "lead", EntityId: 8 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchAttachments",
      expect.objectContaining({ Id: 0, CompId: 5, Entity: "lead", EntityId: 8 }),
    );
    expect(res.json.mock.calls[0][0].data.attachments).toHaveLength(1);
  });

  it("403s listing attachments of a lead the caller cannot see", async () => {
    mockLeadLookup({ Id: 8, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await attachmentController.fetch(baseReq({ body: { Id: 0, Entity: "lead", EntityId: 8 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // no list call
  });

  // Id-only fetch: the entity is derived from the DB row, never the client.
  it("guards an Id-only fetch using the row's own Entity/EntityId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 3, Entity: "task", EntityId: 12, FileName: "x.png", StoredName: "u.png" }]],
    });
    mockTaskPermission(false);
    const res = mockRes();
    await attachmentController.fetch(baseReq({ body: { Id: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_CheckTaskPermission",
      expect.objectContaining({ TaskId: 12, Action: "view_task" }),
    );
  });

  it("500s when the DB throws", async () => {
    mockLeadLookup({ Id: 8, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await attachmentController.fetch(baseReq({ body: { Id: 0, Entity: "lead", EntityId: 8 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("ATTACHMENT_FETCH_ERROR");
  });
});

describe("attachmentController.download", () => {
  it("400s without Id", async () => {
    const res = mockRes();
    await attachmentController.download(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("404s when the row is not found for this company", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await attachmentController.download(baseReq({ body: { Id: 99 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // REGRESSION: any user in the company could download any attachment by Id —
  // including files on tasks in a colleague's personal workspace.
  it("403s downloading a file whose parent record the caller cannot see", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 3, Entity: "lead", EntityId: 8, StoredName: "u.pdf", FileName: "x.pdf" }]],
    });
    mockLeadLookup({ Id: 8, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await attachmentController.download(baseReq({ body: { Id: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("403s downloading a task file the workspace SP denies (personal beats admin)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 3, Entity: "task", EntityId: 12, StoredName: "u.png", FileName: "x.png" }]],
    });
    mockTaskPermission(false);
    const req = baseReq({ scope: { branchIds: [2], ownerIds: null, isAdmin: true } });
    req.body = { Id: 3 };
    const res = mockRes();
    await attachmentController.download(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("streams the file with download headers when access is allowed and the file exists", async () => {
    const fs = require("fs");
    const existsSpy = jest.spyOn(fs, "existsSync").mockReturnValueOnce(true);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 3, Entity: "lead", EntityId: 8, StoredName: "u.pdf", FileName: "x.pdf", MimeType: "application/pdf" }]],
    });
    mockLeadLookup({ Id: 8, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    const res = mockRes();
    res.setHeader = jest.fn();
    res.sendFile = jest.fn();
    await attachmentController.download(baseReq({ body: { Id: 3 } }), res);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="x.pdf"',
    );
    expect(res.sendFile).toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("404s when access is allowed but the file is missing on disk", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 3, Entity: "lead", EntityId: 8, StoredName: "does-not-exist.pdf", FileName: "x.pdf" }]],
    });
    mockLeadLookup({ Id: 8, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    const res = mockRes();
    await attachmentController.download(baseReq({ body: { Id: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe("File missing on disk");
  });

  it("500s when the DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await attachmentController.download(baseReq({ body: { Id: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("attachmentController.delete", () => {
  it("400s without Id", async () => {
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deletes the row after verifying access to its parent record", async () => {
    // lookup row -> guard (ticket visible) -> delete
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 3, Entity: "ticket", EntityId: 42, StoredName: "u.png", FileName: "x.png" }]],
    });
    mockTicketLookup({ Id: 42, BranchId: 2, AssignedTo: 3, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Attachment deleted", StoredName: "u.png", Entity: "ticket" }]],
    });
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: { Id: 3 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteAttachment",
      { Id: 3, CompId: 5 },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("404s deleting an attachment that does not exist for this company", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: { Id: 99 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  // REGRESSION: delete used to run before any record-level check.
  it("403s deleting a file whose parent record the caller cannot see, without deleting", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 3, Entity: "lead", EntityId: 8, StoredName: "u.pdf", FileName: "x.pdf" }]],
    });
    mockLeadLookup({ Id: 8, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: { Id: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // no delete call
  });

  it("500s when the DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: { Id: 3 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("ATTACHMENT_DELETE_ERROR");
  });
});

describe("attachmentController.cascadeDelete", () => {
  it("fetches + deletes rows for an entity and never throws on SP error", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ StoredName: "a.png", Entity: "task" }]],
    });
    await expect(attachmentController.cascadeDelete(5, "task", 12)).resolves.toBeUndefined();
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteAttachmentsByEntity",
      { CompId: 5, Entity: "task", EntityId: 12 },
    );
  });

  it("swallows errors (cleanup must not fail the parent delete)", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    await expect(attachmentController.cascadeDelete(5, "task", 12)).resolves.toBeUndefined();
  });
});
