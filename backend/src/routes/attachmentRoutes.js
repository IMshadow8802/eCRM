const express = require("express");
const attachmentController = require("../controllers/attachmentController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { uploadSingle } = require("../middleware/upload");
const { requirePayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Run multer, translating its errors (size/type) into clean 400s.
function handleUpload(req, res, next) {
  uploadSingle(req, res, (err) => {
    if (err) {
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      const badType = err.message === "UNSUPPORTED_FILE_TYPE";
      return res.status(400).json({
        success: false,
        message: tooBig
          ? "File exceeds the 50MB limit"
          : badType
            ? "Unsupported file type"
            : "Upload failed",
        code: tooBig ? "FILE_TOO_LARGE" : badType ? "UNSUPPORTED_FILE_TYPE" : "UPLOAD_ERROR",
        responseCode: 400,
        timestamp: new Date().toISOString(),
      });
    }
    next();
  });
}

router.post("/save", handleUpload, attachmentController.save);
router.post("/fetch", requirePayload, attachmentController.fetch);
router.post("/download", requirePayload, attachmentController.download);
router.post("/delete", requirePayload, attachmentController.delete);

module.exports = router;
