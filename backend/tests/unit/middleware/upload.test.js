jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  mkdir: jest.fn((dir, opts, cb) => cb(null)),
}));

const fs = require("fs");
const path = require("path");
const {
  fileFilter,
  safeEntity,
  storage,
  ALLOWED,
  EXT_ONLY,
  MAX_SIZE,
  MAX_SIZE_MB,
  ENTITIES,
  UPLOAD_ROOT,
} = require("../../../src/middleware/upload");

// fileFilter's multer signature is (req, file, cb) — cb(err) rejects,
// cb(null, true) accepts. Exercise it directly rather than booting multer.
function filter(originalname, mimetype) {
  const cb = jest.fn();
  fileFilter({}, { originalname, mimetype }, cb);
  return cb;
}

const accepted = (name, mime) => {
  const cb = filter(name, mime);
  expect(cb).toHaveBeenCalledWith(null, true);
};

const rejected = (name, mime) => {
  const cb = filter(name, mime);
  expect(cb).toHaveBeenCalledWith(expect.any(Error));
  expect(cb.mock.calls[0][0].message).toBe("UNSUPPORTED_FILE_TYPE");
};

describe("upload middleware", () => {
  describe("size limit", () => {
    it("caps uploads at 200MB", () => {
      expect(MAX_SIZE).toBe(200 * 1024 * 1024);
    });

    // The route's 400 message is built from MAX_SIZE_MB so the two can never
    // drift apart the way the old hardcoded "50MB" string did.
    it("exposes the limit in MB for the route error message", () => {
      expect(MAX_SIZE_MB).toBe(200);
      expect(MAX_SIZE_MB).toBe(MAX_SIZE / (1024 * 1024));
    });
  });

  describe("fileFilter — strict mime+extension types", () => {
    it("accepts a file whose mime and extension agree", () => {
      accepted("photo.png", "image/png");
      accepted("scan.pdf", "application/pdf");
      accepted("sheet.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    });

    it("accepts either extension for a multi-extension mime", () => {
      accepted("a.jpg", "image/jpeg");
      accepted("a.jpeg", "image/jpeg");
    });

    it("is case-insensitive on the extension", () => {
      accepted("PHOTO.PNG", "image/png");
    });

    it("rejects a mime that is not on the whitelist at all", () => {
      rejected("evil.sh", "application/x-sh");
      rejected("page.html", "text/html");
    });

    // The whole point of matching both: a .html renamed to .png still carries
    // its real mime, and a .png mime with an .html extension is a smuggle.
    it("rejects when the mime is allowed but the extension disagrees", () => {
      rejected("payload.html", "image/png");
      rejected("payload.svg", "image/jpeg");
    });

    it("rejects a file with no extension", () => {
      rejected("README", "application/pdf");
    });
  });

  describe("fileFilter — extension-authoritative build artifacts", () => {
    // Regression: these were rejected outright before, because no APK mime was
    // on the whitelist. Uploading a build to a task 400'd every time.
    it("accepts .apk regardless of which mime the browser guessed", () => {
      accepted("app-release.apk", "application/vnd.android.package-archive");
      accepted("app-release.apk", "application/octet-stream");
      accepted("app-release.apk", "");
      accepted("app-release.apk", undefined);
    });

    it("accepts .aab and .zip on the same terms", () => {
      accepted("app-release.aab", "application/octet-stream");
      accepted("build.zip", "application/zip");
      accepted("build.zip", "application/x-zip-compressed");
      accepted("build.zip", "");
    });

    it("is case-insensitive on the extension", () => {
      accepted("App-Release.APK", "");
    });

    // The bypass is keyed to the extension only — an unknown mime on an
    // unlisted extension must still be refused.
    it("does not let an unknown mime through on a non-artifact extension", () => {
      rejected("script.sh", "application/octet-stream");
      rejected("noext", "application/octet-stream");
    });

    it("lists exactly the artifact extensions that skip the mime check", () => {
      expect([...EXT_ONLY].sort()).toEqual([".aab", ".apk", ".zip"]);
    });
  });

  // Found in the live pass, 2026-09-19: a WebP logo uploaded happily, and the
  // PDF then rendered with no logo at all — @react-pdf/renderer logs "Not valid
  // image extension" and draws nothing, without throwing. The customer gets a
  // letterhead with a hole in it and nobody is told why.
  describe("fileFilter — a quotation picture must be something a PDF can draw", () => {
    const forEntity = (Entity, originalname, mimetype) => {
      const cb = jest.fn();
      fileFilter({ body: { Entity } }, { originalname, mimetype }, cb);
      return cb;
    };

    it.each([["quotation"], ["quoteprofile"]])("refuses a WebP for %s", (entity) => {
      expect(forEntity(entity, "logo.webp", "image/webp").mock.calls[0][0]).toMatchObject({
        message: "NOT_A_PDF_IMAGE",
      });
    });

    it.each([
      ["quoteprofile", "logo.png", "image/png"],
      ["quoteprofile", "logo.jpg", "image/jpeg"],
      ["quotation", "site.jpeg", "image/jpeg"],
    ])("still takes %s %s", (entity, name, mime) => {
      expect(forEntity(entity, name, mime)).toHaveBeenCalledWith(null, true);
    });

    // A PDF is a fine attachment on a lead; it is not a letterhead.
    it("refuses a PDF as a quotation picture", () => {
      expect(forEntity("quoteprofile", "terms.pdf", "application/pdf").mock.calls[0][0]).toMatchObject({
        message: "NOT_A_PDF_IMAGE",
      });
    });

    // The rule is scoped: everywhere else a WebP is shown in a browser, which
    // draws it perfectly well.
    it.each([["task"], ["ticket"], ["lead"]])("leaves WebP alone for %s", (entity) => {
      expect(forEntity(entity, "shot.webp", "image/webp")).toHaveBeenCalledWith(null, true);
    });
  });

  describe("safeEntity", () => {
    it.each(["task", "ticket", "lead"])("maps %s to its own directory", (e) => {
      expect(safeEntity({ body: { Entity: e } })).toBe(e);
    });

    it("lowercases the entity before matching", () => {
      expect(safeEntity({ body: { Entity: "TASK" } })).toBe("task");
    });

    // A caller-supplied Entity reaches path.join, so anything unrecognised —
    // including traversal attempts — must collapse to the literal "misc".
    it("quarantines an unknown or hostile entity under misc", () => {
      expect(safeEntity({ body: { Entity: "../../etc" } })).toBe("misc");
      expect(safeEntity({ body: { Entity: "invoice" } })).toBe("misc");
      expect(safeEntity({ body: {} })).toBe("misc");
      expect(safeEntity({})).toBe("misc");
    });
  });

  describe("diskStorage", () => {
    beforeEach(() => jest.clearAllMocks());

    it("creates and returns the entity directory", (done) => {
      storage.getDestination(
        { body: { Entity: "task" } },
        { originalname: "a.apk" },
        (err, dir) => {
          expect(err).toBeNull();
          expect(dir).toBe(path.join(UPLOAD_ROOT, "task"));
          expect(fs.mkdir).toHaveBeenCalledWith(
            dir, { recursive: true }, expect.any(Function),
          );
          done();
        },
      );
    });

    it("propagates an mkdir failure instead of writing the file", (done) => {
      const boom = new Error("EACCES");
      fs.mkdir.mockImplementationOnce((dir, opts, cb) => cb(boom));
      storage.getDestination({ body: { Entity: "task" } }, {}, (err) => {
        expect(err).toBe(boom);
        done();
      });
    });

    it("routes an unknown entity to the misc directory", (done) => {
      storage.getDestination({ body: { Entity: "nope" } }, {}, (err, dir) => {
        expect(dir).toBe(path.join(UPLOAD_ROOT, "misc"));
        done();
      });
    });

    // Stored names are random UUIDs — the client filename never touches the
    // filesystem, so a hostile originalname cannot escape the entity dir.
    it("stores under a random uuid keeping only the extension", (done) => {
      storage.getFilename({}, { originalname: "app-release.APK" }, (err, name) => {
        expect(err).toBeNull();
        expect(name).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$/,
        );
        expect(name).not.toContain("app-release");
        done();
      });
    });

    it("discards a traversal attempt in the client filename", (done) => {
      storage.getFilename({}, { originalname: "../../../evil.zip" }, (err, name) => {
        expect(name).not.toContain("..");
        expect(name).not.toContain("/");
        expect(name.endsWith(".zip")).toBe(true);
        done();
      });
    });

    it("produces a distinct name for two uploads of the same file", (done) => {
      const file = { originalname: "build.apk" };
      storage.getFilename({}, file, (_e, first) => {
        storage.getFilename({}, file, (_e2, second) => {
          expect(first).not.toBe(second);
          done();
        });
      });
    });
  });

  describe("exports", () => {
    // Keep in step with sp_SaveAttachment's whitelist (091 §4).
    it("accepts quotation and quoteprofile uploads", () => {
      expect([...ENTITIES].sort()).toEqual(["lead", "quotation", "quoteprofile", "task", "ticket"]);
    });

    it("still whitelists the original document and media mimes", () => {
      expect(ALLOWED["image/png"]).toEqual([".png"]);
      expect(ALLOWED["application/pdf"]).toEqual([".pdf"]);
      expect(Object.keys(ALLOWED)).toHaveLength(12);
    });
  });
});
