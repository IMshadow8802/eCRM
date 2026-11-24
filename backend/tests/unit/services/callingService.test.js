jest.mock("../../../src/services/calendarContext");
const cc = require("../../../src/services/calendarContext");
const { callbackReleaseAt, releaseAtFor, shapeMyList, pagination } = require("../../../src/services/callingService");
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");

// 2026-10-07 is a Wednesday; DEFAULT_DAYS shift 09:00-18:00, Sunday off
const ctx = (over = {}) => ({ days: DEFAULT_DAYS, holidays: new Set(), marks: new Map(), ...over });

describe("callbackReleaseAt", () => {
  it("releases at the end of the next working day", () => {
    expect(callbackReleaseAt(at("2026-10-07", 16 * 60), ctx())).toEqual(at("2026-10-08", 18 * 60));
  });
  it("skips a holiday and the weekly off", () => {
    expect(callbackReleaseAt(at("2026-10-07", 16 * 60), ctx({ holidays: new Set(["2026-10-08"]) }))).toEqual(at("2026-10-09", 18 * 60));
    expect(callbackReleaseAt(at("2026-10-10", 11 * 60), ctx())).toEqual(at("2026-10-12", 18 * 60)); // Sat → Mon
  });
  it("falls back to 23:59 two days after when no working day is found", () => {
    const off = DEFAULT_DAYS.map((d) => ({ ...d, on: false }));
    expect(callbackReleaseAt(at("2026-10-07", 16 * 60), ctx({ days: off }))).toEqual(at("2026-10-09", 23 * 60 + 59));
  });
});

describe("releaseAtFor", () => {
  beforeEach(() => jest.resetAllMocks());
  it("loads the caller's calendar and computes the cut-off", async () => {
    cc.load.mockResolvedValue(new Map([[7, { ctx: ctx() }]]));
    expect(await releaseAtFor(1, 7, at("2026-10-07", 16 * 60))).toEqual(at("2026-10-08", 18 * 60));
    expect(cc.load).toHaveBeenCalledWith(1, [7], "2026-10-07", "2026-10-22");
  });
  it("answers null when the calendar cannot be read", async () => {
    cc.load.mockRejectedValue(new Error("down"));
    expect(await releaseAtFor(1, 7, new Date())).toBeNull();
  });
  it("answers null when the person has no calendar row", async () => {
    cc.load.mockResolvedValue(new Map());
    expect(await releaseAtFor(1, 7, new Date())).toBeNull();
  });
});

describe("shapeMyList", () => {
  it("turns Extra into label/value lines and survives bad JSON", () => {
    const out = shapeMyList({ recordsets: [[{ ToCall: 1 }], [{ Id: 1, Extra: '{"Turnover":"2 Cr"}' }, { Id: 2, Extra: "{oops" }, { Id: 3, Extra: null }],
      [{ Id: 4, Extra: '["x"]' }], [{ AttemptId: 5 }], [{ CallListId: 4 }]] });
    expect(out.toCall[0].extras).toEqual([{ label: "Turnover", value: "2 Cr" }]);
    expect(out.toCall[1].extras).toEqual([]);
    expect(out.toCall[2].extras).toEqual([]);
    expect(out.toCall[0]).not.toHaveProperty("Extra");
    expect(out.callbacks[0].extras).toEqual([]);
    expect(out.head.ToCall).toBe(1);
    expect(out.done).toEqual([{ AttemptId: 5 }]);
    expect(out.lists).toEqual([{ CallListId: 4 }]);
  });
  it("gives empty sets when the procedure returned nothing", () => {
    expect(shapeMyList({})).toEqual({ head: {}, toCall: [], callbacks: [], done: [], lists: [] });
  });
});

describe("pagination", () => {
  it("reads RS2, falling back to the request and the row count", () => {
    expect(pagination({ recordsets: [[], [{ TotalRecords: 40, TotalPages: 2, CurrentPage: 2, PageSize: 25 }]] }, 1, 10, 0))
      .toEqual({ currentPage: 2, pageSize: 25, totalRecords: 40, totalPages: 2 });
    expect(pagination({}, 1, 10, 3)).toEqual({ currentPage: 1, pageSize: 10, totalRecords: 3, totalPages: 1 });
    expect(pagination(null, 1, 10, 0)).toEqual({ currentPage: 1, pageSize: 10, totalRecords: 0, totalPages: 0 });
  });
});
