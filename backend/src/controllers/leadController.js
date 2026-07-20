const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const attachmentController = require("./attachmentController");
const {
  scopeParams,
  canSeeRecord,
  assertRecordAccess,
} = require("../middleware/permission");

// Mutating SPs (sp_SaveLead, sp_MoveLeadStage, sp_TransferLead, sp_DeleteLead)
// log their own activity server-side and swallow that logger's result set,
// so they always return exactly one status row: Id + ResponseCode + ResponseMess.
async function runSp(res, spName, params, failMessage) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;

    if (spResponse.ResponseCode === 200) {
      return responseHelper.success(res, message, spResponse);
    }
    return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, failMessage);
  }
}

const leadController = {
  save(req, res) {
    const { CompId, BranchId, UserId } = req.user;
    const { Id = 0 } = req.body;
    return runSp(
      res,
      "sp_SaveLead",
      { ...req.body, Id, CompId, BranchId, UserId },
      "Failed to save lead",
    );
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const {
        // Optional UI filters — they narrow within scope, never widen it.
        // Visibility comes from req.scope, not from the caller's own BranchId.
        BranchId = null,
        PageNumber = 1,
        PageSize = 10,
        SearchTerm = null,
        StageId = null,
        OwnerId = null,
        SourceId = null,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_FetchLeads", {
        CompId,
        BranchId,
        PageNumber,
        PageSize,
        SearchTerm,
        StageId,
        OwnerId,
        SourceId,
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

      const result = await database.executeStoredProcedure("sp_FetchLeadDetail", {
        CompId,
        LeadId,
      });

      const lead = (result.recordsets[0] && result.recordsets[0][0]) || null;

      // The detail SP is CompId-scoped only, so gate the row here. 404 rather
      // than 403: a user who cannot see a lead should not learn it exists.
      if (!canSeeRecord(req, lead, "OwnerId")) {
        return responseHelper.error(res, "Lead not found", "NOT_FOUND", 404);
      }

      const fields = result.recordsets[1] || [];
      const activity = result.recordsets[2] || [];

      return responseHelper.success(res, "Lead detail fetched successfully", {
        lead,
        fields,
        activity,
      });
    } catch (err) {
      console.error("sp_FetchLeadDetail error:", err);
      return responseHelper.error(res, "Failed to fetch lead detail");
    }
  },

  async moveStage(req, res) {
    const { CompId, UserId } = req.user;
    const { LeadId, StageId, LostReasonId = null } = req.body;
    if (!(await assertRecordAccess(req, res, "lead", LeadId))) return;
    return runSp(
      res,
      "sp_MoveLeadStage",
      { CompId, LeadId, StageId, LostReasonId, UserId },
      "Failed to move lead stage",
    );
  },

  async transfer(req, res) {
    const { CompId, UserId } = req.user;
    const { LeadId, OwnerId } = req.body;
    if (!(await assertRecordAccess(req, res, "lead", LeadId))) return;
    return runSp(
      res,
      "sp_TransferLead",
      { CompId, LeadId, OwnerId, UserId },
      "Failed to transfer lead",
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
