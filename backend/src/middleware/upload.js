// Multipart upload handling for attachments (tasks / tickets / leads).
// Files always land under a relative `uploads/<entity>/` dir → inside the
// container that's /app/uploads/<entity>/, which is the per-client host volume
// mounted by docker-compose. Same code, different host dir per client.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const ENTITIES = new Set(["task", "ticket", "lead"]);
const MAX_SIZE = 200 * 1024 * 1024; // 200 MB — release APKs run 20-150 MB

// mime + extension whitelist — never trust the client mime alone, so both must
// pass. Covers images, video, pdf, excel, word.
const ALLOWED = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
  "video/quicktime": [".mov"],
  "application/pdf": [".pdf"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

// Build artifacts, where the browser mime is unreliable and cannot be matched:
// the same .apk arrives as application/vnd.android.package-archive from Chrome,
// application/octet-stream from Safari/Finder, and occasionally as an empty
// string. For these the extension is authoritative and the mime is ignored.
//
// The tradeoff is explicit: a renamed file can pass this branch. It is bounded
// because attachments are never served inline — download() always sends
// Content-Disposition: attachment, so the browser writes the bytes to disk and
// never executes or renders them, and the endpoint is JWT- + CompId-gated.
const EXT_ONLY = new Set([".apk", ".aab", ".zip"]);

function safeEntity(req) {
  const e = String(req.body?.Entity || "").toLowerCase();
  return ENTITIES.has(e) ? e : "misc";
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    // Client must append the Entity text field BEFORE the file part so it's
    // parsed into req.body by the time this runs.
    const dir = path.join(UPLOAD_ROOT, safeEntity(req));
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (EXT_ONLY.has(ext)) return cb(null, true);
  const exts = ALLOWED[file.mimetype];
  if (!exts || !exts.includes(ext)) {
    return cb(new Error("UNSUPPORTED_FILE_TYPE"));
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });

module.exports = {
  uploadSingle: upload.single("file"),
  UPLOAD_ROOT,
  ENTITIES,
  MAX_SIZE,
  MAX_SIZE_MB: MAX_SIZE / (1024 * 1024),
  ALLOWED,
  EXT_ONLY,
  fileFilter,
  safeEntity,
  storage,
};
