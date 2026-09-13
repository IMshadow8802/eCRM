const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const attachmentController = require("./attachmentController");
const {
  scopeParams,
  canSeeRecord,
  assertRecordAccess,
  assertCanAssign,
} = require("../middleware/permission");
const { positiveInt, pageParams } = require("../utils/controllerKit");

// Mutating SPs log their own activity server-side and return exactly one
// status row: Id + ResponseCode + ResponseMess.
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

// Exactly the columns sp_SaveLead accepts. Anything else in the body is dropped.
const LEAD_FIELDS = [
  "Name", "Company", "MobileNo", "AltMobile", "Email",
  "Address", "City", "State", "Pincode",
  "SourceId", "ProductId", "StatusId", "OwnerId", "EstValue", "Remarks",
  "FirstFollowupAt", "CustomJSON",
];
const pick = (body, keys) => Object.fromEntries(keys.map((k) => [k, body[k] ?? null]));
const bit = (v) => v === true || v === 1 || v === "1" || v === "true";
const blank = (s) => !s || !String(s).trim();

// Shared by transfer and bulkTransfer: the SP requires both, and refusing
// here saves the lookup round-trips.
const transferArgs = (body) => ({
  ToUserId: positiveInt(body.ToUserId),
  ToBranchId: positiveInt(body.ToBranchId),
  ReasonId: positiveInt(body.ReasonId),
  Remarks: body.Remarks == null ? null : String(body.Remarks).trim(),
});

// A drill-down from a report carries the range it counted. Anything that is
// not a plain ISO day is dropped rather than handed to the SP as-is.
const isoDay = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

const leadController = {
  async save(req, res) {
    const { CompId, BranchId, UserId } = req.user;
    const Id = positiveInt(req.body.Id) ?? 0;
    const fields = pick(req.body, LEAD_FIELDS);
    if (Id > 0) {
      if (!(await assertRecordAccess(req, res, "lead", Id))) return;
      // Ownership moves through transfer (history), status through setStatus
      // (guards). The SP ignores these on update; not sending them keeps that
      // fact visible here rather than buried in T-SQL.
      fields.OwnerId = null;
      fields.StatusId = null;
      fields.FirstFollowupAt = null;
    }
    // Assigning on create is still an assignment: same roster rule as transfer.
    // Only when a target is named — an unassigned create is legal for everyone,
    // while assertCanAssign 403s a null target below Branch scope.
    if (Id === 0 && fields.OwnerId
        && !(await assertCanAssign(req, res, { toUserId: fields.OwnerId, toBranchId: null }))) return;
    return runSp(res, "sp_SaveLead", { Id, CompId, BranchId, UserId, ...fields }, "Failed to save lead");
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const {
        BranchId = null, SearchTerm = null,
        StatusId = null, StatusCode = null, ProductId = null, OwnerId = null, SourceId = null,
        Overdue = false, Unassigned = false, FromDate = null, ToDate = null,
      } = req.body;
      // Clamped, not taken raw: PageSize went straight to the SP, and
      // sp_FetchLeads has no ceiling of its own.
      const { PageNumber, PageSize } = pageParams(req.body);

      const result = await database.executeStoredProcedure("sp_FetchLeads", {
        CompId, BranchId, PageNumber, PageSize, SearchTerm,
        StatusId, StatusCode, ProductId, OwnerId, SourceId,
        Overdue: bit(Overdue), Unassigned: bit(Unassigned),
        FromDate: isoDay(FromDate), ToDate: isoDay(ToDate),
        ...scopeParams(req),
      });

      const leads = result.recordsets[0] || [];
      const pagination = (result.recordsets[1] && result.recordsets[1][0]) || {};
      return responseHelper.success(res, "Leads fetched successfully", {
        leads,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? leads.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchLeads error:", err);
      return responseHelper.error(res, "Failed to fetch leads");
    }
  },

  async detail(req, res) {
    try {
      const { CompId } = req.user;
      const { LeadId } = req.body;
      const result = await database.executeStoredProcedure("sp_FetchLeadDetail", { CompId, LeadId });
      const rs = result.recordsets ?? [];
      const lead = rs[0]?.[0] || null;
      // 404 rather than 403: a user who cannot see a lead should not learn it exists.
      if (!canSeeRecord(req, lead, "OwnerId")) {
        return responseHelper.error(res, "Lead not found", "NOT_FOUND", 404);
      }
      return responseHelper.success(res, "Lead detail fetched successfully", {
        lead,
        fields: rs[1] || [],
        activity: rs[2] || [],
        followups: rs[3] || [],
        assignments: rs[4] || [],
      });
    } catch (err) {
      console.error("sp_FetchLeadDetail error:", err);
      return responseHelper.error(res, "Failed to fetch lead detail");
    }
  },

  async setStatus(req, res) {
    const { CompId, UserId } = req.user;
    const { LeadId, StatusId, LostReasonId = null } = req.body;
    if (!(await assertRecordAccess(req, res, "lead", LeadId))) return;
    return runSp(
      res,
      "sp_SetLeadStatus",
      { CompId, LeadId, StatusId, LostReasonId, UserId },
      "Failed to update lead status",
    );
  },

  async transfer(req, res) {
    const { CompId, UserId } = req.user;
    const { LeadId } = req.body;
    const args = transferArgs(req.body);
    if (blank(args.Remarks) || !args.ReasonId) {
      return responseHelper.validationError(res, "A reason and remarks are required for a transfer");
    }
    if (!(await assertRecordAccess(req, res, "lead", LeadId))) return;
    if (!(await assertCanAssign(req, res, { toUserId: args.ToUserId, toBranchId: args.ToBranchId }))) return;
    return runSp(res, "sp_TransferLead", { CompId, LeadId, ...args, UserId }, "Failed to transfer lead");
  },

  async bulkTransfer(req, res) {
    const { CompId, UserId } = req.user;
    const ids = Array.isArray(req.body.LeadIds)
      ? [...new Set(req.body.LeadIds.map(positiveInt).filter(Boolean))]
      : [];
    const args = transferArgs(req.body);
    if (ids.length === 0 || ids.length > 200) {
      return responseHelper.validationError(res, "Pick between 1 and 200 leads");
    }
    if (blank(args.Remarks) || !args.ReasonId) {
      return responseHelper.validationError(res, "A reason and remarks are required for a transfer");
    }
    // Every lead must be visible to the caller; the SP is tenant-scoped only.
    // ponytail: N sequential sp_FetchLeadDetail reads (5 recordsets each), ≤200 ids;
    // upgrade path = one sp_FetchLeadsVisibility(@LeadIdsJson) returning
    // Id/BranchId/OwnerId/CreatedBy + canSeeRecord per row.
    for (const id of ids) {
      if (!(await assertRecordAccess(req, res, "lead", id))) return;
    }
    if (!(await assertCanAssign(req, res, { toUserId: args.ToUserId, toBranchId: args.ToBranchId }))) return;
    return runSp(
      res,
      "sp_BulkTransferLeads",
      { CompId, LeadIdsJson: JSON.stringify(ids), ...args, UserId },
      "Failed to transfer leads",
    );
  },

  async delete(req, res) {
    const { CompId } = req.user;
    const { Id } = req.body;
    if (!(await assertRecordAccess(req, res, "lead", Id))) return;
    try {
      const result = await database.executeStoredProcedure("sp_DeleteLead", { Id, CompId });
      const spResponse = result.recordset[0];
      const message = spResponse.ResponseMess || spResponse.ResponseMessage;
      if (spResponse.ResponseCode === 200) {
        await attachmentController.cascadeDelete(CompId, "lead", Id);
        return responseHelper.success(res, message, spResponse);
      }
      return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
    } catch (err) {
      console.error("sp_DeleteLead error:", err);
      return responseHelper.error(res, "Failed to delete lead");
    }
  },
};

module.exports = leadController;
