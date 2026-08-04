const { cleanSpRows } = require("../../../src/utils/spHelpers");

describe("cleanSpRows", () => {
  describe("envelope stripping", () => {
    it("strips the status + pagination columns SPs bolt onto every row", () => {
      const rows = [
        {
          Id: 1,
          Name: "Acme",
          ResponseCode: 200,
          ResponseMess: "Success",
          ResponseMessage: "Success",
          TotalRecords: 2,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 25,
        },
      ];

      expect(cleanSpRows(rows)).toEqual([{ Id: 1, Name: "Acme" }]);
    });

    it("leaves rows without envelope columns unchanged", () => {
      const rows = [
        { Id: 1, Name: "Acme", OwnerId: 7 },
        { Id: 2, Name: "Globex", OwnerId: 3 },
      ];
      expect(cleanSpRows(rows)).toEqual(rows);
    });

    it("keeps genuine NULL data columns — only the envelope goes", () => {
      const rows = [
        { Id: 1, Name: "Acme", ClosedAt: null, ResolutionId: null, ResponseCode: 200 },
      ];
      expect(cleanSpRows(rows)).toEqual([
        { Id: 1, Name: "Acme", ClosedAt: null, ResolutionId: null },
      ]);
    });

    it("does not mutate the input rows", () => {
      const row = { Id: 1, Name: "Acme", ResponseCode: 200, TotalRecords: 1 };
      const rows = [row];

      cleanSpRows(rows);

      expect(row).toEqual({ Id: 1, Name: "Acme", ResponseCode: 200, TotalRecords: 1 });
      expect(rows).toHaveLength(1);
    });
  });

  describe("placeholder rows", () => {
    // The reason this helper exists: an empty fetch still returns one all-NULL
    // row so the column shape is stable, and that ghost breaks any consumer
    // doing `rows.length > 0 ⇒ real data`.
    it("drops the all-NULL placeholder row an empty fetch returns", () => {
      const rows = [
        {
          Id: null,
          Name: null,
          OwnerId: null,
          ResponseCode: 200,
          ResponseMess: "No records found",
          TotalRecords: 0,
        },
      ];
      expect(cleanSpRows(rows)).toEqual([]);
    });

    it("drops a row whose pk is undefined (column absent)", () => {
      expect(cleanSpRows([{ Name: "orphan" }])).toEqual([]);
    });

    it("keeps real rows and drops the placeholder from a mixed recordset", () => {
      const rows = [
        { Id: 1, Name: "Acme", ResponseCode: 200 },
        { Id: null, Name: null, ResponseCode: 200 },
        { Id: 2, Name: "Globex", ResponseCode: 200 },
      ];
      expect(cleanSpRows(rows)).toEqual([
        { Id: 1, Name: "Acme" },
        { Id: 2, Name: "Globex" },
      ]);
    });

    // Falsy-but-real ids must survive: the filter tests for null/undefined,
    // not for truthiness, so Id = 0 and Id = "" are kept.
    it.each([
      ["zero", 0],
      ["an empty string", ""],
      ["false", false],
    ])("keeps a row whose pk is %s", (_label, pk) => {
      expect(cleanSpRows([{ Id: pk, Name: "edge" }])).toEqual([
        { Id: pk, Name: "edge" },
      ]);
    });
  });

  describe("pkField", () => {
    it("honours a custom pk (workspace members are keyed by UserId)", () => {
      const rows = [
        { UserId: 5, FullName: "Asha", Role: "owner", ResponseCode: 200 },
        { UserId: null, FullName: null, Role: null, ResponseCode: 200 },
      ];
      expect(cleanSpRows(rows, "UserId")).toEqual([
        { UserId: 5, FullName: "Asha", Role: "owner" },
      ]);
    });

    // Footgun worth knowing: the default pk is "Id", so calling it on a
    // recordset keyed by something else silently returns [] — real rows and
    // placeholder alike are dropped for want of an Id column.
    it("silently drops every row when the default pk is absent", () => {
      const rows = [
        { UserId: 5, FullName: "Asha" },
        { UserId: 6, FullName: "Bala" },
      ];
      expect(cleanSpRows(rows)).toEqual([]);
    });

    it("treats an envelope column as the pk if asked to (nothing is special-cased)", () => {
      const rows = [{ Id: 1, ResponseCode: 200 }];
      // ResponseCode is destructured away before the filter runs, so the pk
      // it is looking for no longer exists on the cleaned row.
      expect(cleanSpRows(rows, "ResponseCode")).toEqual([]);
    });
  });

  describe("non-recordset input", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an object", { Id: 1 }],
      ["a string", "rows"],
      ["a number", 7],
    ])("returns [] for %s", (_label, input) => {
      expect(cleanSpRows(input)).toEqual([]);
    });

    it("returns [] for an empty recordset", () => {
      expect(cleanSpRows([])).toEqual([]);
    });
  });
});
