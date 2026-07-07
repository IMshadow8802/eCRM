jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const attachmentController = require("../../../src/controllers/attachmentController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    body: {},
    file: null,
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

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
});

describe("attachmentController.fetch", () => {
  it("400s when Id:0 without Entity/EntityId", async () => {
    const res = mockRes();
    await attachmentController.fetch(baseReq({ body: { Id: 0 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns a list scoped to CompId", async () => {
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
});

describe("attachmentController.delete", () => {
  it("400s without Id", async () => {
    const res = mockRes();
    await attachmentController.delete(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deletes the row and reports success", async () => {
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
