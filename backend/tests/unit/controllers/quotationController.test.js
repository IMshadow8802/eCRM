jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const quotationController = require("../../../src/controllers/quotationController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: {
      hierarchyLevel: 3, dataScope: "Branch", primaryBranchId: 2,
      branchIds: [2], ownerIds: null, canWriteBranchIds: [2], isAdmin: false,
    },
    body: {},
    ...overrides,
  };
}

beforeEach(() => database.executeStoredProcedure.mockReset());

// The two gate lookups. A quotation's header carries its LEAD's owner/branch.
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 };
const hiddenLead = { Id: 9, BranchId: 77, OwnerId: 999, CreatedBy: 999 };
const draft = { Id: 4, LeadId: 9, Status: "draft", OwnerId: 7, BranchId: 2, CreatedBy: 7 };
const mockLead = (lead) => database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [lead ? [lead] : [], [], [], [], []] });
const mockQuote = (q) => database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [q ? [q] : [], [], []] });
const okRow = (extra = {}) => ({ recordset: [{ Id: 4, ResponseCode: 200, ResponseMess: "Quotation saved", ...extra }] });

const BODY = {
  LeadId: 9, TemplateCode: "modern", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "5 kW rooftop",
  ToName: "Ramesh Patel", ToCompany: null, ToMobile: "+91 98250 12345", ToEmail: "r@p.in",
  ToAddress: "12 SG Road", ToCity: "Ahmedabad", ToStateCode: "24", ToPincode: "380015", ToGSTIN: " 24aaaaa0000a1z5 ",
  Company: { name: "Solar Care", gstin: "24abcde1234f1z5", stateCode: "99", accent: "#1e3a8a", logoAttachmentId: 12 },
  Content: { intro: "<p>Dear Ramesh ji</p>", terms: "<p>50% advance</p>", notes: "", sections: [{ type: "text", title: "Why us", body: "<p>x</p>" }] },
  Lines: [{ productId: 7, description: "5 kW Solar Rooftop", hsn: "8541", qty: "1", unit: "Nos", rate: "280000", discountType: "amt", discountValue: "10000", taxPct: "12", lineTotal: 999999 }],
};

describe("quotationController.save", () => {
  it("creates on a lead the caller can see, and sends the SP exactly its parameters", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    const res = mockRes();
    await quotationController.save(baseReq({ body: { ...BODY, CompId: 999, GrandTotal: 1 } }), res);

    const [sp, p] = database.executeStoredProcedure.mock.calls[1];
    expect(sp).toBe("sp_SaveQuotation");
    expect(p).toMatchObject({
      Id: 0, CompId: 5, UserId: 7, LeadId: 9, TemplateCode: "modern",
      QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "5 kW rooftop",
      ToName: "Ramesh Patel", ToMobile: "9825012345", ToStateCode: "24", ToGSTIN: "24AAAAA0000A1Z5",
      SellerGSTIN: "24ABCDE1234F1Z5",
    });
    // The web never sends a total, and one that is sent goes nowhere.
    expect(p).not.toHaveProperty("GrandTotal");
    expect(JSON.parse(p.LinesJSON)).toEqual([{
      productId: 7, description: "5 kW Solar Rooftop", hsn: "8541", qty: 1, unit: "Nos",
      rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12,
    }]);
    expect(JSON.parse(p.CompanyJSON).name).toBe("Solar Care");
    expect(JSON.parse(p.ContentJSON).sections).toHaveLength(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // The seller's state is LEFT(GSTIN, 2) and the SP derives it. Whatever the
  // client claims travels along and is ignored — asserted here so nobody "fixes"
  // the controller into trusting it.
  it("passes the company block's state through without trusting it", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await quotationController.save(baseReq({ body: BODY }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1].SellerStateCode).toBe("99");
  });

  it("403s a create on a lead the caller cannot see, before the SP", async () => {
    mockLead(hiddenLead);
    const res = mockRes();
    await quotationController.save(baseReq({ body: BODY }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("on update gates on the QUOTATION and keeps it on its own lead, whatever the body says", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await quotationController.save(baseReq({ body: { ...BODY, Id: 4, LeadId: 12345 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0]).toEqual(["sp_FetchQuotationDetail", { CompId: 5, QuotationId: 4 }]);
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ Id: 4, LeadId: 9 });
  });

  it.each([
    [{ LeadId: undefined }, "LeadId is required"],
    [{ TemplateCode: "fancy" }, "Unknown template"],
    [{ ToMobile: "12345" }, "Mobile number must be 10 digits"],
    [{ ToStateCode: "GJ" }, "Place of supply must be a 2-digit state code"],
    [{ QuoteDate: "2026-02-30" }, "QuoteDate must be YYYY-MM-DD"],
    [{ Lines: "nope" }, "Lines must be a list"],
    [{ Lines: Array.from({ length: 201 }, () => ({ description: "x" })) }, "A quotation can hold at most 200 lines"],
    [{ Content: { intro: "x".repeat(200 * 1024 + 1) } }, "The opening message is too long"],
    [{ Content: { sections: [{ type: "text", body: "x".repeat(200 * 1024 + 1) }] } }, "An extra section is too long"],
  ])("400s %p before touching the DB", async (patch, message) => {
    const res = mockRes();
    await quotationController.save(baseReq({ body: { ...BODY, ...patch } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe(message);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("turns junk numbers in a line into 0 rather than NaN — a draft may be half-typed", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow());
    await quotationController.save(baseReq({ body: { ...BODY, Lines: [{ description: "x", qty: "abc", rate: null }] } }), mockRes());
    expect(JSON.parse(database.executeStoredProcedure.mock.calls[1][1].LinesJSON)[0]).toMatchObject({
      qty: 0, rate: 0, discountType: "pct", discountValue: 0, taxPct: 0, productId: null,
    });
  });

  it("surfaces the SP's 409 (not a draft / lead closed) as-is", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 4, ResponseCode: 409, ResponseMess: "Only a draft can be edited — revise this quotation instead" }],
    });
    const res = mockRes();
    await quotationController.save(baseReq({ body: { ...BODY, Id: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toMatch(/revise/);
  });

  it("500s when the DB throws", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await quotationController.save(baseReq({ body: BODY }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("quotationController.fetch", () => {
  it("lists under the caller's scope, clamps paging, and drops filters it does not recognise", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 4, QuoteNo: "QT-2627-0042" }], [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 200 }]],
    });
    const res = mockRes();
    await quotationController.fetch(baseReq({ body: { PageSize: 99999, Status: "final", LeadId: "9", FromDate: "2026-09-01", ToDate: "junk", OwnerId: "x" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchQuotations", {
      CompId: 5, PageNumber: 1, PageSize: 200, SearchTerm: null, Status: "final",
      OwnerId: null, BranchId: null, LeadId: 9, FromDate: "2026-09-01", ToDate: null,
      UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: null,
    });
    expect(res.json.mock.calls[0][0].data).toEqual({
      quotations: [{ Id: 4, QuoteNo: "QT-2627-0042" }],
      pagination: { currentPage: 1, pageSize: 200, totalRecords: 1, totalPages: 1 },
    });
  });

  it("ignores a status that is not one of the six", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [{}]] });
    await quotationController.fetch(baseReq({ body: { Status: "'; DROP" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].Status).toBeNull();
  });

  it("500s when the DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await quotationController.fetch(baseReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("quotationController.detail", () => {
  const header = { ...draft, QuoteNo: null, CompanyJSON: '{"name":"Solar Care"}', ContentJSON: '{"intro":"<p>hi</p>"}' };

  it("returns header (JSON parsed, raw strings dropped), lines and revisions", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[header], [{ Id: 1 }], [{ Id: 4, Revision: 1 }]] });
    const res = mockRes();
    await quotationController.detail(baseReq({ body: { QuotationId: 4 } }), res);
    const { quotation, lines, revisions } = res.json.mock.calls[0][0].data;
    expect(quotation.Company).toEqual({ name: "Solar Care" });
    expect(quotation.Content).toEqual({ intro: "<p>hi</p>" });
    expect(quotation).not.toHaveProperty("CompanyJSON");
    expect(lines).toEqual([{ Id: 1 }]);
    expect(revisions).toEqual([{ Id: 4, Revision: 1 }]);
  });

  // 404 rather than 403: a user who cannot see a lead should not learn that it
  // has quotations. Same rule as leadController.detail.
  it("404s a quotation whose lead the caller cannot see", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ...header, OwnerId: 999, BranchId: 77, CreatedBy: 999 }], [], []] });
    const res = mockRes();
    await quotationController.detail(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("survives corrupt JSON in a row instead of 500ing the whole page", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ ...header, CompanyJSON: "{oops", ContentJSON: null }], [], []] });
    const res = mockRes();
    await quotationController.detail(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.json.mock.calls[0][0].data.quotation).toMatchObject({ Company: {}, Content: {} });
  });

  it("400s without an id; 500s when the DB throws", async () => {
    const res = mockRes();
    await quotationController.detail(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res2 = mockRes();
    await quotationController.detail(baseReq({ body: { QuotationId: 4 } }), res2);
    expect(res2.status).toHaveBeenCalledWith(500);
  });
});

describe("quotationController lifecycle", () => {
  it.each([
    ["finalise", "sp_FinaliseQuotation", { QuotationId: 4 }, { CompId: 5, QuotationId: 4, UserId: 7 }],
    ["revise", "sp_ReviseQuotation", { QuotationId: 4 }, { CompId: 5, QuotationId: 4, UserId: 7 }],
    ["reject", "sp_RejectQuotation", { QuotationId: 4, Remarks: "  too expensive " }, { CompId: 5, QuotationId: 4, UserId: 7, Remarks: "too expensive" }],
  ])("%s gates on the quotation, then runs %s", async (method, sp, body, params) => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ QuoteNo: "QT-2627-0042" }));
    const res = mockRes();
    await quotationController[method](baseReq({ body }), res);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual([sp, params]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each(["finalise", "revise", "reject", "remove"])("%s 400s without an id and 403s a hidden lead", async (method) => {
    const res = mockRes();
    await quotationController[method](baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();

    mockQuote({ ...draft, OwnerId: 999, BranchId: 77, CreatedBy: 999 });
    const res2 = mockRes();
    await quotationController[method](baseReq({ body: { QuotationId: 4 } }), res2);
    expect(res2.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("finalise hands the quote number back", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ QuoteNo: "QT-2627-0042" }));
    const res = mockRes();
    await quotationController.finalise(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.json.mock.calls[0][0].data.QuoteNo).toBe("QT-2627-0042");
  });

  it("surfaces the SP's 400 (no lines / no place of supply) with its sentence", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 4, ResponseCode: 400, ResponseMess: "Choose the customer's state — GST depends on it", QuoteNo: null }],
    });
    const res = mockRes();
    await quotationController.finalise(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/GST depends on it/);
  });
});

describe("quotationController.remove", () => {
  it("deletes a draft, then clears the pictures uploaded to it", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ Id: 4, ResponseCode: 200, ResponseMess: "Draft deleted" }] });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] }); // cascade
    const res = mockRes();
    await quotationController.remove(baseReq({ body: { QuotationId: 4 } }), res);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_DeleteQuotation", { CompId: 5, QuotationId: 4 }]);
    expect(database.executeStoredProcedure.mock.calls[2]).toEqual([
      "sp_DeleteAttachmentsByEntity", { CompId: 5, Entity: "quotation", EntityId: 4 },
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // An issued quotation is a record. The SP says so; nothing is cleaned up.
  it("passes the SP's 409 through and leaves the attachments alone", async () => {
    mockQuote({ ...draft, Status: "final" });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ Id: 4, ResponseCode: 409, ResponseMess: "Only a draft can be deleted" }] });
    const res = mockRes();
    await quotationController.remove(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
  });

  it("500s when the DB throws", async () => {
    mockQuote(draft);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await quotationController.remove(baseReq({ body: { QuotationId: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("quotationController profile", () => {
  const PROFILE = {
    CompanyName: " Solar Care Pvt Ltd ", Address: "1 Ring Road", City: "Ahmedabad", StateCode: "24", Pincode: "380001",
    GSTIN: "24abcde1234f1z5", Phone: "079-2658", Email: "hi@solar.in", Website: "solar.in", BankDetails: "HDFC 123",
    DefaultIntro: "<p>Dear customer</p>", DefaultTerms: "<p>50% advance</p>", SignatoryName: "Amit",
    LogoAttachmentId: "12", HeaderAttachmentId: null, AccentColor: "#1e3a8a", DefaultTemplate: "modern",
  };

  // A regional manager (branch 2) quoting for a lead in branch 6 gets branch 6's
  // letterhead — the LEAD's branch, never req.user.BranchId.
  it("ensures the profile of the LEAD's branch", async () => {
    mockLead({ ...visibleLead, BranchId: 6 });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3, BranchId: 6, IsSet: false }]] });
    const res = mockRes();
    await quotationController.ensureProfile(baseReq({ body: { LeadId: 9 } }), res);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_EnsureQuoteProfile", { CompId: 5, BranchId: 6, UserId: 7 }]);
    expect(res.json.mock.calls[0][0].data.profile).toEqual({ Id: 3, BranchId: 6, IsSet: false });
  });

  it("ensureProfile 400s without a lead, 403s a hidden one, 500s on a DB error", async () => {
    const res = mockRes();
    await quotationController.ensureProfile(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    mockLead(hiddenLead);
    const res2 = mockRes();
    await quotationController.ensureProfile(baseReq({ body: { LeadId: 9 } }), res2);
    expect(res2.status).toHaveBeenCalledWith(403);

    mockLead(visibleLead);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res3 = mockRes();
    await quotationController.ensureProfile(baseReq({ body: { LeadId: 9 } }), res3);
    expect(res3.status).toHaveBeenCalledWith(500);
  });

  it("saves with the caller's admin bit and the lead's branch; the SP owns the IsSet rule", async () => {
    mockLead({ ...visibleLead, BranchId: 6 });
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 3 }));
    await quotationController.saveProfile(baseReq({ body: { LeadId: 9, ...PROFILE, CompId: 999, IsAdmin: 1, IsSet: 0 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_SaveQuoteProfile", {
      CompId: 5, BranchId: 6, UserId: 7, IsAdmin: 0,
      CompanyName: "Solar Care Pvt Ltd", Address: "1 Ring Road", City: "Ahmedabad", StateCode: "24", Pincode: "380001",
      GSTIN: "24ABCDE1234F1Z5", Phone: "079-2658", Email: "hi@solar.in", Website: "solar.in", BankDetails: "HDFC 123",
      DefaultIntro: "<p>Dear customer</p>", DefaultTerms: "<p>50% advance</p>", SignatoryName: "Amit",
      LogoAttachmentId: 12, HeaderAttachmentId: null, AccentColor: "#1e3a8a", DefaultTemplate: "modern",
    }]);
  });

  it("sends IsAdmin 1 for an admin — never read from the body", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow({ Id: 3 }));
    const req = baseReq({ body: { LeadId: 9, ...PROFILE, IsAdmin: 0 } });
    req.scope.isAdmin = true;
    await quotationController.saveProfile(req, mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1].IsAdmin).toBe(1);
  });

  it("passes the SP's 403 to a non-admin changing a saved letterhead", async () => {
    mockLead(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 3, ResponseCode: 403, ResponseMess: "Only an administrator can change the saved company details" }],
    });
    const res = mockRes();
    await quotationController.saveProfile(baseReq({ body: { LeadId: 9, ...PROFILE } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it.each([
    [{ LeadId: undefined }, "LeadId is required"],
    [{ CompanyName: "  " }, "Company name is required"],
    [{ DefaultTemplate: "fancy" }, "Unknown template"],
    [{ DefaultIntro: "x".repeat(200 * 1024 + 1) }, "The default opening message is too long"],
    [{ DefaultTerms: "x".repeat(200 * 1024 + 1) }, "The default terms are too long"],
  ])("saveProfile 400s %p before touching the DB", async (patch, message) => {
    const res = mockRes();
    await quotationController.saveProfile(baseReq({ body: { LeadId: 9, ...PROFILE, ...patch } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe(message);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("saveProfile 403s a hidden lead without calling sp_SaveQuoteProfile", async () => {
    mockLead(hiddenLead);
    const res = mockRes();
    await quotationController.saveProfile(baseReq({ body: { LeadId: 9, ...PROFILE } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_SaveQuoteProfile", expect.anything());
  });
});
