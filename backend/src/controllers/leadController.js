const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");

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
      const { CompId, BranchId } = req.user;
      const {
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

  moveStage(req, res) {
    const { CompId, UserId } = req.user;
    const { LeadId, StageId, LostReasonId = null } = req.body;
    return runSp(
      res,
      "sp_MoveLeadStage",
      { CompId, LeadId, StageId, LostReasonId, UserId },
      "Failed to move lead stage",
    );
  },

  transfer(req, res) {
    const { CompId, UserId } = req.user;
    const { LeadId, OwnerId } = req.body;
    return runSp(
      res,
      "sp_TransferLead",
      { CompId, LeadId, OwnerId, UserId },
      "Failed to transfer lead",
    );
  },

  delete(req, res) {
    const { CompId } = req.user;
    const { Id } = req.body;
    return runSp(res, "sp_DeleteLead", { Id, CompId }, "Failed to delete lead");
  },
};

module.exports = leadController;
