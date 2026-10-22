const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Visiting-card photos: JPEG only, kept on disk under uploads/cards/<cardId>/ (ported from JRS cardController).
const UPLOAD_ROOT = path.join(process.cwd(), "uploads"); // same root as middleware/upload.js
const CARDS_ROOT = path.join(UPLOAD_ROOT, "cards");
const MAX_PHOTO = 5 * 1024 * 1024;
const MAX_BODY = 2 * MAX_PHOTO + 1024 * 1024;
const TOO_LARGE = "The card is too large. Photos can be up to 5 MB each.";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The body is small (two phone photos): read into memory, parsed by Node's own FormData.
async function readForm(req) {
  if (Number(req.headers["content-length"] || 0) > MAX_BODY) throw new HttpError(413, TOO_LARGE);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, TOO_LARGE);
    chunks.push(chunk);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] } }).formData();
  } catch {
    throw new HttpError(400, "The card could not be read. Send it as multipart/form-data.");
  }
}

async function readPhoto(form, name, required) {
  const file = form.get(name);
  if (!(file instanceof Blob) || file.size === 0) {
    if (required) throw new HttpError(400, `The ${name} photo is missing.`);
    return null;
  }
  if (file.size > MAX_PHOTO) throw new HttpError(413, `The ${name} photo is larger than 5 MB.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new HttpError(415, `The ${name} photo must be a JPEG.`);
  return bytes;
}

// Absolute path of a stored photo, or null if it would leave uploads/cards/.
function photoFile(relPath) {
  const full = path.resolve(UPLOAD_ROOT, String(relPath));
  return full.startsWith(CARDS_ROOT + path.sep) ? full : null;
}

async function writePhoto(id, side, bytes) {
  const rel = path.posix.join("cards", String(id), `${side}-${crypto.randomUUID()}.jpg`);
  const full = photoFile(rel);
  if (!full) throw new HttpError(400, "The card id is not valid.");
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, bytes, { flag: "wx" });
  return rel;
}

async function removePhoto(relPath) {
  const full = photoFile(relPath);
  if (!full) return;
  try { await fs.promises.unlink(full); } catch (e) { if (e.code !== "ENOENT") throw e; }
}

module.exports = { HttpError, UPLOAD_ROOT, readForm, readPhoto, writePhoto, removePhoto, photoFile };
