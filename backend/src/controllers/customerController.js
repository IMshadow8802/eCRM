// Spec 2 §1/§3: the light customer record a complaint hangs off. Scoped by the
// customers module (spec 2026-10-07 §2.5): an office, owned by its creator.
// Delete is admin-only (route).
const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { scopeParams, canSeeRecord, canWriteBranch } = require("../middleware/permission");
const { positiveInt, pageParams } = require("../utils/controllerKit");
const { applyMobiles } = require("../utils/mobile");

// Mutating SPs return exactly one status row: Id + ResponseCode + ResponseMess.
// A non-200 code (400 validation, 409 duplicate mobile / tickets attached) is
// passed through with its message, never flattened into a 500.
async function runSp(res, spName, params, failMessage) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;
    if (spResponse.ResponseCode === 200) return responseHelper.success(res, message, spResponse);
    return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, failMessage);
  }
}

// Exactly the columns sp_SaveCustomer accepts. Anything else in the body is
// dropped — node-mssql sends every key it is given, and SQL Server rejects an
// undeclared parameter outright.
const CUSTOMER_FIELDS = [
  "Name", "ContactPerson", "Mobile", "AltMobile", "Email",
  "Address", "City", "State", "Pincode", "Remarks", "GSTIN",
];
const pick = (body, keys) => Object.fromEntries(keys.map((k) => [k, body[k] ?? null]));
const blank = (s) => !s || !String(s).trim();
const trimmed = (s) => (blank(s) ? null : String(s).trim());
// Default 1, never null: sp_FetchCustomers declares @IsActive BIT = 1 and 086
// defines no meaning for NULL. Only an explicit false / 0 / "false" / "0" is 0.
const activeBit = (v) => (v === false || v === 0 || v === "false" || v === "0" ? 0 : 1);

// A customer's owner is whoever created it. Reads the row unscoped, then applies
// `scope` (default: the route's) — ticketController passes the customers scope.
async function assertCustomerVisible(req, res, customerId, scope = req.scope) {
  const r = await database.executeStoredProcedure("sp_FetchCustomerDetail", {
    CompId: req.user.CompId, CustomerId: Number(customerId) || 0,
    UserId: null, AccessibleBranchIdsJson: "[]", OwnerIdsJson: "[]",
  });
  const row = r.recordsets?.[0]?.[0] || null;
  if (row && canSeeRecord({ ...req, scope }, row, "CreatedBy")) return row;
  responseHelper.error(res, "You do not have access to this customer", "FORBIDDEN", 403);
  return null;
}

const customerController = {
  async save(req, res) {
    const { CompId, UserId } = req.user;
    const Id = positiveInt(req.body.Id) ?? 0;
    const fields = pick(req.body, CUSTOMER_FIELDS);
    // The SP enforces both rules too (spec §1); refusing here names the field
    // and saves the round-trip.
    if (blank(fields.Name)) return responseHelper.validationError(res, "Name is required");
    if (blank(fields.Mobile) && blank(fields.Email)) {
      return responseHelper.validationError(res, "Mobile or Email is required");
    }
    const mobileError = applyMobiles(fields, [["Mobile", "Mobile number"], ["AltMobile", "Alternate mobile"]]);
    if (mobileError) return responseHelper.validationError(res, mobileError);
    // Stored the way it is printed on a registration: upper case, no spaces.
    fields.GSTIN = trimmed(fields.GSTIN)?.toUpperCase().replace(/\s+/g, "") ?? null;
    // Create: the office is the body's, else the caller's home office. Edit: the
    // SP ignores @BranchId; a move goes through MoveToBranchId (null = stay).
    const requested = positiveInt(req.body.BranchId);
    const target = requested ?? (Id ? null : Number(req.scope.primaryBranchId));
    if (target && !canWriteBranch(req, target)) {
      return responseHelper.error(res, "You cannot add customers to that office", "FORBIDDEN", 403);
    }
    let BranchId = target;
    let MoveToBranchId = null;
    if (Id) {
      const existing = await assertCustomerVisible(req, res, Id);
      if (!existing) return;
      BranchId = existing.BranchId; // ignored by the SP on edit; sent as the current office for clarity
      if (target && Number(existing.BranchId) !== target) {
        if (!canWriteBranch(req, existing.BranchId)) {
          return responseHelper.error(res, "You cannot move this customer", "FORBIDDEN", 403);
        }
        MoveToBranchId = target;
      }
    }
    return runSp(
      res,
      "sp_SaveCustomer",
      { Id, CompId, BranchId, UserId, ...fields, MoveToBranchId },
      "Failed to save customer",
    );
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const { SearchTerm = null, BranchId = null, IsActive = 1 } = req.body;
      // Clamped, not taken raw: PageSize goes straight to the SP, which has no
      // ceiling of its own. Default 25 matches the SP's own default.
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      // Scoped by the customers module (spec 2026-10-07 §2.5).
      const result = await database.executeStoredProcedure("sp_FetchCustomers", {
        CompId,
        PageNumber,
        PageSize,
        SearchTerm: trimmed(SearchTerm),
        BranchId: positiveInt(BranchId),
        IsActive: activeBit(IsActive),
        ...scopeParams(req),
      });

      const customers = result.recordsets?.[0] ?? [];
      const pagination = result.recordsets?.[1]?.[0] ?? {};
      return responseHelper.success(res, "Customers fetched successfully", {
        customers,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? customers.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchCustomers error:", err);
      return responseHelper.error(res, "Failed to fetch customers");
    }
  },

  async detail(req, res) {
    const { CompId } = req.user;
    const CustomerId = positiveInt(req.body.CustomerId);
    if (!CustomerId) return responseHelper.validationError(res, "CustomerId is required");
    try {
      // RS1 is gated by the customers scope (req.scope); RS2 is that customer's
      // complaints under the COMPLAINTS scope ("[]" when the role has none).
      const result = await database.executeStoredProcedure("sp_FetchCustomerDetail", {
        CompId,
        CustomerId,
        ...scopeParams(req, "complaints"),
      });
      const rs = result.recordsets ?? [];
      const customer = rs[0]?.[0] || null;
      if (!customer) return responseHelper.error(res, "Customer not found", "NOT_FOUND", 404);
      if (!canSeeRecord(req, customer, "CreatedBy")) {
        return responseHelper.error(res, "You do not have access to this customer", "FORBIDDEN", 403);
      }
      return responseHelper.success(res, "Customer detail fetched successfully", {
        customer,
        tickets: rs[1] || [],
      });
    } catch (err) {
      console.error("sp_FetchCustomerDetail error:", err);
      return responseHelper.error(res, "Failed to fetch customer detail");
    }
  },

  // requireAdmin sits on the route. The SP soft-deletes and answers 409 while
  // any ticket still references the customer — surfaced as-is.
  async delete(req, res) {
    const { CompId } = req.user;
    const Id = positiveInt(req.body.Id);
    if (!Id) return responseHelper.validationError(res, "Id is required");
    return runSp(res, "sp_DeleteCustomer", { Id, CompId }, "Failed to delete customer");
  },
};

module.exports = customerController;
module.exports.assertCustomerVisible = assertCustomerVisible;
