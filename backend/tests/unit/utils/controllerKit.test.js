const {
  asyncRoute,
  firstRow,
  spStatus,
  spOk,
  spMessage,
  pageParams,
  positiveInt,
  MAX_PAGE_SIZE,
} = require("../../../src/utils/controllerKit");
const { mockRes } = require("../../helpers/mockRes");

describe("asyncRoute", () => {
  let consoleError;
  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("passes through the handler's return value when nothing throws", async () => {
    const handler = jest.fn().mockResolvedValue("ok");
    const res = mockRes();
    await expect(asyncRoute(handler, "nope", "X")({}, res)).resolves.toBe("ok");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("forwards req, res and next to the handler", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const req = { body: {} };
    const res = mockRes();
    const next = jest.fn();
    await asyncRoute(handler, "nope", "X")(req, res, next);
    expect(handler).toHaveBeenCalledWith(req, res, next);
  });

  it("turns a thrown error into a 500 carrying the supplied message and code", async () => {
    const handler = jest.fn().mockRejectedValue(new Error("boom"));
    const res = mockRes();
    await asyncRoute(handler, "Failed to fetch teams", "TEAM_FETCH_ERROR")({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.message).toBe("Failed to fetch teams");
    expect(body.code).toBe("TEAM_FETCH_ERROR");
  });

  it("catches a synchronous throw as well as a rejected promise", async () => {
    const handler = () => {
      throw new Error("sync boom");
    };
    const res = mockRes();
    await asyncRoute(handler, "msg", "CODE")({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("logs the error so it is not swallowed", async () => {
    const err = new Error("boom");
    const res = mockRes();
    await asyncRoute(jest.fn().mockRejectedValue(err), "msg", "CODE")({}, res);
    expect(consoleError).toHaveBeenCalledWith("CODE:", err);
  });

  it("does NOT write a second response when the handler already replied", async () => {
    // A handler that responds and then throws — awaiting a logger, say. Writing
    // again raises ERR_HTTP_HEADERS_SENT, which buries the real error.
    const handler = async (req, res) => {
      res.status(200).json({ ok: true });
      throw new Error("late failure");
    };
    const res = mockRes();
    res.headersSent = true;

    await asyncRoute(handler, "msg", "CODE")({}, res);

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("firstRow", () => {
  it("returns the first row of the first recordset", () => {
    expect(firstRow({ recordsets: [[{ Id: 1 }, { Id: 2 }]] })).toEqual({ Id: 1 });
  });

  it.each([
    ["an empty recordset", { recordsets: [[]] }],
    ["no recordsets", { recordsets: [] }],
    ["no recordsets key", {}],
    ["null", null],
    ["undefined", undefined],
  ])("returns null for %s instead of throwing", (_label, input) => {
    expect(firstRow(input)).toBeNull();
  });
});

describe("spStatus", () => {
  it("returns the SP's own code", () => {
    expect(spStatus({ ResponseCode: 404 })).toBe(404);
    expect(spStatus({ ResponseCode: 201 })).toBe(201);
  });

  it("accepts a numeric string, since mssql types vary by column", () => {
    expect(spStatus({ ResponseCode: "200" })).toBe(200);
  });

  it.each([
    ["missing", {}],
    ["null row", null],
    ["undefined code", { ResponseCode: undefined }],
    ["non-numeric", { ResponseCode: "fine" }],
    ["out of HTTP range", { ResponseCode: 42 }],
    ["absurd", { ResponseCode: 99999 }],
  ])("falls back to 500 when the code is %s", (_label, row) => {
    // 500, not 200: a status row with no usable code is malformed, and calling
    // that success is how a failure gets reported as an empty list.
    expect(spStatus(row)).toBe(500);
  });

  it("honours an explicit fallback", () => {
    expect(spStatus({}, 200)).toBe(200);
  });
});

describe("spOk", () => {
  it.each([200, 201, 204, 299])("treats %i as success", (code) => {
    expect(spOk({ ResponseCode: code })).toBe(true);
  });

  it.each([199, 300, 400, 403, 404, 500])("treats %i as failure", (code) => {
    expect(spOk({ ResponseCode: code })).toBe(false);
  });

  it("is false for a malformed row rather than throwing", () => {
    expect(spOk(null)).toBe(false);
    expect(spOk({})).toBe(false);
  });

  /**
   * The reason this helper exists: `ResponseCode === 200` and
   * `ResponseCode < 300` were both in use, sometimes in the same file, so a 201
   * was success on one endpoint and failure on its neighbour.
   */
  it("agrees with itself about 201, which the two old idioms did not", () => {
    expect(spOk({ ResponseCode: 201 })).toBe(true);
  });
});

describe("spMessage", () => {
  it("reads ResponseMess", () => {
    expect(spMessage({ ResponseMess: "saved" })).toBe("saved");
  });

  it("reads ResponseMessage, the other spelling in use", () => {
    expect(spMessage({ ResponseMessage: "saved" })).toBe("saved");
  });

  it("prefers ResponseMess when a row carries both", () => {
    expect(spMessage({ ResponseMess: "a", ResponseMessage: "b" })).toBe("a");
  });

  it("returns the fallback for a missing or null row", () => {
    expect(spMessage(null, "default")).toBe("default");
    expect(spMessage({}, "default")).toBe("default");
    expect(spMessage({})).toBe("");
  });
});

describe("pageParams", () => {
  it("defaults to page 1 and the supplied default size", () => {
    expect(pageParams({}, 25)).toEqual({ PageNumber: 1, PageSize: 25 });
  });

  it("passes through legitimate values", () => {
    expect(pageParams({ PageNumber: 3, PageSize: 50 })).toEqual({
      PageNumber: 3,
      PageSize: 50,
    });
  });

  it("coerces numeric strings, which is what a JSON body usually carries", () => {
    expect(pageParams({ PageNumber: "2", PageSize: "20" })).toEqual({
      PageNumber: 2,
      PageSize: 20,
    });
  });

  /** The resource-exhaustion vector: paging went to the SP unclamped. */
  it("clamps an absurd page size to the ceiling", () => {
    expect(pageParams({ PageSize: 999999999 }).PageSize).toBe(MAX_PAGE_SIZE);
  });

  it("clamps a default larger than the ceiling too", () => {
    expect(pageParams({}, 100000).PageSize).toBe(MAX_PAGE_SIZE);
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["non-numeric", "abc"],
    ["null", null],
  ])("falls back to the default for a %s page size", (_label, PageSize) => {
    expect(pageParams({ PageSize }, 10).PageSize).toBe(10);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["non-numeric", "abc"],
  ])("falls back to page 1 for a %s page number", (_label, PageNumber) => {
    // A negative page number became a negative SQL OFFSET.
    expect(pageParams({ PageNumber }).PageNumber).toBe(1);
  });

  it("floors a fractional page size rather than passing a decimal to SQL", () => {
    expect(pageParams({ PageNumber: 2.7, PageSize: 10.9 })).toEqual({
      PageNumber: 2,
      PageSize: 10,
    });
  });

  it("tolerates a missing body", () => {
    expect(pageParams(undefined, 10)).toEqual({ PageNumber: 1, PageSize: 10 });
  });
});

describe("positiveInt", () => {
  it("returns the number for a valid id", () => {
    expect(positiveInt(7)).toBe(7);
    expect(positiveInt("7")).toBe(7);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["non-numeric", "abc"],
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["object", {}],
  ])("returns null for %s", (_label, value) => {
    expect(positiveInt(value)).toBeNull();
  });
});
