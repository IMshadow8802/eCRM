// Attachment route surface: handleUpload translates multer's errors into
// clean 400s. Only uploadSingle is stubbed — MAX_SIZE_MB stays real so the
// size message is asserted against the actual configured limit.
jest.mock("../../../src/middleware/upload", () => {
  const actual = jest.requireActual("../../../src/middleware/upload");
  return { ...actual, uploadSingle: jest.fn() };
});

jest.mock("../../../src/middleware/auth", () => ({
  verifyToken: (req, _res, next) => {
    req.user = { UserId: 1, CompId: 1, BranchId: 1 };
    next();
  },
}));

jest.mock("../../../src/middleware/permission", () => ({
  loadScope: (_req, _res, next) => next(),
}));

jest.mock("../../../src/controllers/attachmentController", () => ({
  save: jest.fn((req, res) => res.status(200).json({ success: true, reached: true })),
  fetch: jest.fn((req, res) => res.status(200).json({ success: true })),
  download: jest.fn((req, res) => res.status(200).json({ success: true })),
  delete: jest.fn((req, res) => res.status(200).json({ success: true })),
}));

const express = require("express");
const request = require("supertest");
const { uploadSingle, MAX_SIZE_MB } = require("../../../src/middleware/upload");
const attachmentController = require("../../../src/controllers/attachmentController");
const attachmentRoutes = require("../../../src/routes/attachmentRoutes");

const app = express();
app.use(express.json());
app.use("/api/attachments", attachmentRoutes);

// Drive handleUpload by deciding what multer hands back.
const multerYields = (err) => uploadSingle.mockImplementation((req, res, cb) => cb(err));

describe("attachmentRoutes — upload error translation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes through to the controller when multer succeeds", async () => {
    multerYields(null);
    const r = await request(app).post("/api/attachments/save");
    expect(r.status).toBe(200);
    expect(r.body.reached).toBe(true);
    expect(attachmentController.save).toHaveBeenCalled();
  });

  // REGRESSION: the message was the hardcoded string "File exceeds the 50MB
  // limit" and stayed at 50 when MAX_SIZE moved to 200MB, telling users the
  // wrong number. It is now derived from MAX_SIZE_MB.
  it("reports the real configured limit on an oversized file", async () => {
    multerYields({ code: "LIMIT_FILE_SIZE" });
    const r = await request(app).post("/api/attachments/save");
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("FILE_TOO_LARGE");
    expect(r.body.message).toBe(`File exceeds the ${MAX_SIZE_MB}MB limit`);
    expect(r.body.message).toContain("200MB");
    expect(attachmentController.save).not.toHaveBeenCalled();
  });

  it("400s an unsupported file type", async () => {
    multerYields(new Error("UNSUPPORTED_FILE_TYPE"));
    const r = await request(app).post("/api/attachments/save");
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect(attachmentController.save).not.toHaveBeenCalled();
  });

  it("400s any other multer failure without leaking its message", async () => {
    multerYields(new Error("ENOSPC: no space left on device"));
    const r = await request(app).post("/api/attachments/save");
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("UPLOAD_ERROR");
    expect(r.body.message).toBe("Upload failed");
  });
});
