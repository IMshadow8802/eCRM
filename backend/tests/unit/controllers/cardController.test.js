// Visiting cards from the VisiScan app: save (multipart + photos on disk), fetch, delete.
jest.mock("../../../src/config/database", () => ({ executeStoredProcedure: jest.fn() }));

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const database = require("../../../src/config/database");
const { mockRes } = require("../../helpers/mockRes");
const { mockAccess } = require("../../helpers/mockAccess");
const { scopeFor } = require("../../../src/middleware/access");

let tmp, c;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cardctl-"));
  jest.spyOn(process, "cwd").mockReturnValue(tmp);
  c = require("../../../src/controllers/cardController");
});
afterAll(() => { jest.restoreAllMocks(); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  fs.rmSync(path.join(tmp, "uploads"), { recursive: true, force: true });
});

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const fields = (over = {}) => ({
  id: ID.toUpperCase(), businessName: "राम ट्रेडर्स", contactPerson: "Ram", designation: "", website: "", gstin: "",
  description: "", other: "", notes: "", mobiles: '["9825012345"]', landlines: "[]", emails: "[]", addresses: "[]",
  createdAt: "2026-10-22T10:00:00+05:30", updatedAt: "2026-10-22T10:05:00+05:30", ...over,
});

// A caller: Own reach on cards unless rights/reach say otherwise.
function caller(rights = "va", reach = "Own") {
  const access = mockAccess({ modules: [["cards", rights, reach]] });
  return { user: { UserId: 7, CompId: 5, BranchId: 9 }, access, scope: scopeFor(access, "cards", 7) };
}

async function saveReq({ over, front = JPEG, back = JPEG, rights, reach } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields(over))) if (v !== undefined) form.set(k, v);
  if (front) form.set("front", new Blob([front]), "f.jpg");
  if (back) form.set("back", new Blob([back]), "b.jpg");
  const r = new Request("http://x/", { method: "POST", body: form });
  const req = Readable.from([Buffer.from(await r.arrayBuffer())]);
  req.headers = { "content-type": r.headers.get("content-type") };
  req.body = {};
  return Object.assign(req, caller(rights, reach));
}
const saveRow = (row) => ({ recordset: [row], recordsets: [[row]] });
const filesOnDisk = () => {
  const dir = path.join(tmp, "uploads", "cards", ID);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};
const sent = (res) => ({ status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] });

describe("saveCard", () => {
  it("inserts: SP gets the caller, office, JSON lists and Own-reach CanEditOthers 0; files kept", async () => {
    database.executeStoredProcedure.mockResolvedValue(saveRow({ Saved: true, ResponseCode: 200, ResponseMess: "Card saved" }));
    const res = mockRes();
    await c.saveCard(await saveReq(), res);
    const { status, body } = sent(res);
    expect(status).toBe(200);
    expect(body.data).toEqual({ id: ID });
    const [sp, p] = database.executeStoredProcedure.mock.calls[0];
    expect(sp).toBe("sp_SaveVisitingCard");
    expect(p).toMatchObject({
      Id: ID, CompId: 5, UserId: 7, BranchId: 2, CanEditOthers: 0, BusinessName: "राम ट्रेडर्स",
      Mobiles: '["9825012345"]', Landlines: "[]", AppCreatedAt: "2026-10-22T04:30:00.000Z",
      AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]",
    });
    expect(p.FrontPath).toMatch(new RegExp(`^cards/${ID}/front-.+\\.jpg$`));
    expect(p.BackPath).toMatch(/back-.+\.jpg$/);
    expect(filesOnDisk()).toEqual([path.basename(p.BackPath), path.basename(p.FrontPath)].sort());
  });

  it("an editor passes CanEditOthers 1; no back photo sends BackPath null", async () => {
    database.executeStoredProcedure.mockResolvedValue(saveRow({ Saved: true, ResponseCode: 200, ResponseMess: "ok" }));
    const res = mockRes();
    await c.saveCard(await saveReq({ rights: "vae", reach: "Office", back: null }), res);
    const p = database.executeStoredProcedure.mock.calls[0][1];
    expect(p.CanEditOthers).toBe(1);
    expect(p.BackPath).toBeNull();
    expect(filesOnDisk()).toHaveLength(1);
  });

  it("stale (Saved 0, 200) answers 200 and removes both new files", async () => {
    database.executeStoredProcedure.mockResolvedValue(saveRow({ Saved: false, ResponseCode: 200, ResponseMess: "Already up to date" }));
    const res = mockRes();
    await c.saveCard(await saveReq(), res);
    expect(sent(res).status).toBe(200);
    expect(filesOnDisk()).toEqual([]);
  });

  it("newer (Saved 1 with OldFront/OldBack) removes the old files and keeps the new", async () => {
    const dir = path.join(tmp, "uploads", "cards", ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "front-old.jpg"), JPEG);
    fs.writeFileSync(path.join(dir, "back-old.jpg"), JPEG);
    database.executeStoredProcedure.mockResolvedValue(saveRow({
      Saved: true, ResponseCode: 200, ResponseMess: "Card updated",
      OldFront: `cards/${ID}/front-old.jpg`, OldBack: `cards/${ID}/back-old.jpg` }));
    const res = mockRes();
    await c.saveCard(await saveReq(), res);
    expect(sent(res).status).toBe(200);
    const p = database.executeStoredProcedure.mock.calls[0][1];
    expect(filesOnDisk()).toEqual([path.basename(p.BackPath), path.basename(p.FrontPath)].sort());
  });

  it("an old path equal to the new one is not removed", async () => {
    database.executeStoredProcedure.mockImplementation(async (sp, p) =>
      saveRow({ Saved: true, ResponseCode: 200, ResponseMess: "ok", OldFront: p.FrontPath, OldBack: null }));
    const res = mockRes();
    await c.saveCard(await saveReq({ back: null }), res);
    expect(filesOnDisk()).toHaveLength(1);
  });

  it("403 from the SP passes through and removes the new files", async () => {
    database.executeStoredProcedure.mockResolvedValue(saveRow({ Saved: false, ResponseCode: 403, ResponseMess: "Not your card" }));
    const res = mockRes();
    await c.saveCard(await saveReq(), res);
    const { status, body } = sent(res);
    expect(status).toBe(403);
    expect(body).toMatchObject({ message: "Not your card", code: "CARD_SAVE_ERROR" });
    expect(filesOnDisk()).toEqual([]);
  });

  it("old-photo removal failing (EACCES) still answers 200 and logs", async () => {
    const dir = path.join(tmp, "uploads", "cards", ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "front-old.jpg"), JPEG);
    database.executeStoredProcedure.mockResolvedValue(saveRow({
      Saved: true, ResponseCode: 200, ResponseMess: "Card updated", OldFront: `cards/${ID}/front-old.jpg`, OldBack: null }));
    const unlink = jest.spyOn(fs.promises, "unlink").mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await c.saveCard(await saveReq(), res);
    unlink.mockRestore();
    expect(sent(res).status).toBe(200);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("back-photo write failing removes the already-written front photo (500)", async () => {
    const real = fs.promises.writeFile.bind(fs.promises);
    let n = 0;
    const w = jest.spyOn(fs.promises, "writeFile").mockImplementation((...a) => (++n === 2 ? Promise.reject(new Error("disk full")) : real(...a)));
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await c.saveCard(await saveReq(), res);
    w.mockRestore(); err.mockRestore();
    expect(sent(res).status).toBe(500);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(filesOnDisk()).toEqual([]);
  });

  it("an SP throw is a 500 and removes the new files", async () => {
    database.executeStoredProcedure.mockRejectedValue(new Error("db down"));
    const res = mockRes();
    await c.saveCard(await saveReq(), res);
    expect(sent(res).status).toBe(500);
    expect(filesOnDisk()).toEqual([]);
  });

  it("an SP with no row is a 500 and removes the new files", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordset: [], recordsets: [[]] });
    const res = mockRes();
    await c.saveCard(await saveReq(), res);
    expect(sent(res).status).toBe(500);
    expect(filesOnDisk()).toEqual([]);
  });

  it.each([
    ["mobiles not a JSON array", { over: { mobiles: "9825012345" } }, 400, /mobiles/],
    ["bad id", { over: { id: "nope" } }, 400, /id/],
    ["missing field", { over: { businessName: undefined } }, 400, /businessName/],
    ["PNG front", { front: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }, 415, /JPEG/],
    ["6 MB front", { front: Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]) }, 413, /5 MB/],
    ["missing front", { front: null }, 400, /front photo is missing/],
  ])("%s → rejected, nothing written, no SP call", async (_n, opts, status, msg) => {
    const res = mockRes();
    await c.saveCard(await saveReq(opts), res);
    const { status: s, body } = sent(res);
    expect(s).toBe(status);
    expect(body.code).toBe("CARD_INVALID");
    expect(body.message).toMatch(msg);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(filesOnDisk()).toEqual([]);
  });

  it("Review Focus 1: two concurrent saves of one card → both 200, one pair of files left", async () => {
    database.executeStoredProcedure
      .mockResolvedValueOnce(saveRow({ Saved: true, ResponseCode: 200, ResponseMess: "Card saved" }))
      .mockResolvedValueOnce(saveRow({ Saved: false, ResponseCode: 200, ResponseMess: "Already saved" }));
    const [r1, r2] = [mockRes(), mockRes()];
    await Promise.all([c.saveCard(await saveReq(), r1), c.saveCard(await saveReq(), r2)]);
    expect([sent(r1).status, sent(r2).status]).toEqual([200, 200]);
    const files = filesOnDisk();
    expect(files).toHaveLength(2);
    expect(files.filter((f) => f.startsWith("front-"))).toHaveLength(1);
  });
});

const ROW = {
  Id: ID.toUpperCase(), BusinessName: "A", ContactPerson: "B", Designation: "", Website: "", Gstin: "", Description: "",
  Other: "", Notes: "", Mobiles: '["9825012345"]', Landlines: "[]", Emails: "bad json", Addresses: "[]",
  FrontPath: `cards/${ID}/front-1.jpg`, BackPath: null, AppCreatedAt: new Date("2026-10-22T04:30:00Z"),
  AppUpdatedAt: new Date("2026-10-22T04:35:00Z"), ReceivedAt: new Date("2026-10-22T10:06:00Z"), OwnerId: 7, OwnerName: "Ram",
};
const fetchResult = (total, rows) => ({ recordsets: [[{ TotalCount: total }], rows] });
const fetchReq = (body, rights = "v") => ({ ...caller(rights), body });

describe("fetchCard", () => {
  it("maps rows and pages the list", async () => {
    database.executeStoredProcedure.mockResolvedValue(fetchResult(120, [ROW]));
    const res = mockRes();
    await c.fetchCard(fetchReq({}), res);
    const { status, body } = sent(res);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ totalCount: 120, pageNumber: 1, pageSize: 50, totalPages: 3,
      pagination: { currentPage: 1, pageSize: 50, totalRecords: 120, totalPages: 3 } });
    expect(body.data.rows[0]).toEqual({
      id: ID, businessName: "A", contactPerson: "B", designation: "", mobiles: ["9825012345"], landlines: [],
      emails: [], addresses: [], website: "", gstin: "", description: "", other: "", notes: "",
      createdAt: "2026-10-22T04:30:00.000Z", updatedAt: "2026-10-22T04:35:00.000Z",
      frontImage: `cards/${ID}/front-1.jpg`, backImage: "", ownerName: "Ram", receivedAt: ROW.ReceivedAt,
    });
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchVisitingCards", {
      CompId: 5, Id: null, Search: "", PageNumber: 1, PageSize: 50, UserId: 7,
      AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]" });
  });

  it("clamps pageSize 500 to 200; PascalCase aliases honoured; camel wins", async () => {
    database.executeStoredProcedure.mockResolvedValue(fetchResult(0, []));
    const res = mockRes();
    await c.fetchCard(fetchReq({ SearchTerm: "ram", PageNumber: 3, pageSize: 500, PageSize: 10 }), res);
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ Search: "ram", PageNumber: 3, PageSize: 200 });
    expect(sent(res).body.data).toMatchObject({ rows: [], totalCount: 0, totalPages: 0 });
    await c.fetchCard(fetchReq({ search: "a", SearchTerm: "b", pageNumber: 2, PageNumber: 9 }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ Search: "a", PageNumber: 2 });
  });

  it("one card by id", async () => {
    database.executeStoredProcedure.mockResolvedValue(fetchResult(1, [{ ...ROW, BackPath: `cards/${ID}/back-1.jpg` }]));
    const res = mockRes();
    await c.fetchCard(fetchReq({ id: ID }), res);
    expect(sent(res).body.data.rows[0].backImage).toBe(`cards/${ID}/back-1.jpg`);
    expect(database.executeStoredProcedure.mock.calls[0][1].Id).toBe(ID);
  });

  it("id not found → 404; id not a UUID → 400 without a DB call", async () => {
    database.executeStoredProcedure.mockResolvedValue(fetchResult(0, []));
    const res = mockRes();
    await c.fetchCard(fetchReq({ id: ID }), res);
    expect(sent(res)).toMatchObject({ status: 404, body: { message: "Card not found" } });
    database.executeStoredProcedure.mockClear();
    const bad = mockRes();
    await c.fetchCard(fetchReq({ id: "x" }), bad);
    expect(sent(bad).status).toBe(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("a DB failure is a 500", async () => {
    database.executeStoredProcedure.mockRejectedValue(new Error("down"));
    const res = mockRes();
    await c.fetchCard(fetchReq({}), res);
    expect(sent(res).status).toBe(500);
  });
});

describe("deleteCard", () => {
  it("200 pass-through, scoped by the cards reach", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200, ResponseMess: "Card deleted" }]] });
    const res = mockRes();
    await c.deleteCard(fetchReq({ id: ID }, "vd"), res);
    expect(sent(res)).toMatchObject({ status: 200, body: { message: "Card deleted", data: { id: ID } } });
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteVisitingCard", {
      Id: ID, CompId: 5, UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]" });
  });
  it("repeat on an already-deleted card: SP's 200 'Already deleted' → 200 with { id }", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 200, ResponseMess: "Already deleted" }]] });
    const res = mockRes();
    await c.deleteCard(fetchReq({ id: ID }, "vd"), res);
    expect(sent(res)).toMatchObject({ status: 200, body: { message: "Already deleted", data: { id: ID } } });
  });
  it("404 pass-through", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[{ ResponseCode: 404, ResponseMess: "This card was not found." }]] });
    const res = mockRes();
    await c.deleteCard(fetchReq({ id: ID }, "vd"), res);
    expect(sent(res)).toMatchObject({ status: 404, body: { code: "CARD_DELETE_ERROR" } });
  });
  it("bad id → 400 without a DB call", async () => {
    const res = mockRes();
    await c.deleteCard(fetchReq({ id: "1" }, "vd"), res);
    expect(sent(res).status).toBe(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});
