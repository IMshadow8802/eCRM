const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");

let tmp, mod;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cardphotos-"));
  jest.spyOn(process, "cwd").mockReturnValue(tmp);
  mod = require("../../../src/utils/cardPhotos");
});
afterAll(() => { jest.restoreAllMocks(); fs.rmSync(tmp, { recursive: true, force: true }); });

const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
const formWith = (name, bytes) => { const f = new FormData(); if (bytes) f.set(name, new Blob([bytes]), "p.jpg"); return f; };
const fail = async (p, status, msg) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(mod.HttpError);
  expect(e.status).toBe(status);
  if (msg) expect(e.message).toBe(msg);
};

describe("readPhoto", () => {
  it("returns the bytes of a JPEG", async () => {
    expect((await mod.readPhoto(formWith("front", jpeg), "front", true)).equals(jpeg)).toBe(true);
  });
  it("415 for a PNG", async () => {
    await fail(mod.readPhoto(formWith("front", Buffer.from([0x89, 0x50, 0x4e])), "front", true), 415, "The front photo must be a JPEG.");
  });
  it("413 over 5 MB", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1); jpeg.copy(big);
    await fail(mod.readPhoto(formWith("front", big), "front", true), 413);
  });
  it("400 when a required photo is missing", async () => {
    await fail(mod.readPhoto(formWith("front"), "front", true), 400, "The front photo is missing.");
  });
  it("null when an optional photo is missing", async () => {
    expect(await mod.readPhoto(formWith("back"), "back", false)).toBeNull();
  });
});

describe("readForm", () => {
  it("413 when content-length exceeds the cap", async () => {
    await fail(mod.readForm({ headers: { "content-length": String(11 * 1024 * 1024 + 1) } }), 413);
  });
  it("413 when the stream exceeds the cap", async () => {
    const req = Readable.from([Buffer.alloc(11 * 1024 * 1024 + 1)]); req.headers = {};
    await fail(mod.readForm(req), 413);
  });
  it("400 when unparsable", async () => {
    const req = Readable.from([Buffer.from("junk")]); req.headers = { "content-type": "text/plain" };
    await fail(mod.readForm(req), 400);
  });
  it("parses multipart", async () => {
    const src = formWith("front", jpeg); src.set("id", "x");
    const r = new Response(src);
    const req = Readable.from([Buffer.from(await r.arrayBuffer())]); req.headers = { "content-type": r.headers.get("content-type") };
    expect((await mod.readForm(req)).get("id")).toBe("x");
  });
});

describe("writePhoto / removePhoto / photoFile", () => {
  it("writePhoto rejects an id escaping cards", async () => {
    await expect(mod.writePhoto("../..", "front", jpeg)).rejects.toMatchObject({ status: 400 });
  });
  it("removePhoto ignores a foreign path", async () => {
    await expect(mod.removePhoto("../x")).resolves.toBeUndefined();
  });
  it("writes under uploads/cards then removes", async () => {
    const rel = await mod.writePhoto("abc", "front", jpeg);
    expect(rel).toMatch(/^cards\/abc\/front-[0-9a-f-]{36}\.jpg$/);
    const full = mod.photoFile(rel);
    expect(full.startsWith(path.join(fs.realpathSync(tmp), "uploads", "cards")) || full.startsWith(path.join(tmp, "uploads", "cards"))).toBe(true);
    expect(fs.existsSync(full)).toBe(true);
    await mod.removePhoto(rel);
    expect(fs.existsSync(full)).toBe(false);
    await expect(mod.removePhoto(rel)).resolves.toBeUndefined(); // ENOENT ignored
  });
  it("removePhoto rethrows other errors", async () => {
    const rel = await mod.writePhoto("dir", "back", jpeg);
    const spy = jest.spyOn(fs.promises, "unlink").mockRejectedValueOnce(Object.assign(new Error("x"), { code: "EACCES" }));
    await expect(mod.removePhoto(rel)).rejects.toThrow("x");
    spy.mockRestore();
    await mod.removePhoto(rel);
  });
  it("photoFile blocks traversal and foreign folders", () => {
    expect(mod.photoFile("cards/x/../../etc/passwd")).toBeNull();
    expect(mod.photoFile("../secret")).toBeNull();
    expect(mod.photoFile("tasks/1/a.jpg")).toBeNull();
    expect(mod.photoFile("cards/id/front-a.jpg")).toBe(path.join(mod.UPLOAD_ROOT, "cards", "id", "front-a.jpg"));
  });
});
