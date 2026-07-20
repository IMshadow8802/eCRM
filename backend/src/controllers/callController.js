const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { assertRecordAccess } = require("../middleware/permission");

// Save-type SP: returns a single row with ResponseCode/ResponseMess.
// Optional (req, log) fire an audit entry to tblActivityLog on success.
async function runSp(res, spName, params, failMessage, req, log) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;

    if (spResponse.ResponseCode === 200) {
      if (req && log) await logActivity({ ...log, req });
      return responseHelper.success(res, message, spResponse);
    }
    return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, failMessage);
  }
}

const callController = {
  // Logs a call against a lead OR a ticket (exactly one of LeadId/TicketId set).
  async logCall(req, res) {
    const { CompId, UserId } = req.user;
    const {
      LeadId = null,
      TicketId = null,
      Direction,
      OutcomeId = null,
      Notes = null,
      Duration = null,
      NextFollowupDate = null,
      FollowupRemarks = null,
    } = req.body;
    if (!LeadId && !TicketId) {
      return responseHelper.validationError(res, "LeadId or TicketId is required");
    }
    // The caller must be able to see the record they log a call against.
    const entity = LeadId ? "lead" : "ticket";
    if (!(await assertRecordAccess(req, res, entity, LeadId ?? TicketId))) return;
    return runSp(
      res,
      "sp_LogCall",
      {
        CompId,
        LeadId,
        TicketId,
        UserId,
        Direction,
        OutcomeId,
        Notes,
        Duration,
        NextFollowupDate,
        FollowupRemarks,
      },
      "Failed to log call",
      req,
      {
        entityType: LeadId ? "Lead" : "Ticket",
        entityId: LeadId ?? TicketId ?? 0,
        action: ACTIONS.COMMENTED,
        description: `Call logged (${Direction || "call"})`,
      },
    );
  },

  // Fetches calls by lead (LeadId in body) or falls back to the caller's own calls.
  async fetchCalls(req, res) {
    try {
      const { CompId, UserId } = req.user;
      const { LeadId = null } = req.body;

      const result = await database.executeStoredProcedure("sp_FetchCalls", {
        CompId,
        LeadId,
        UserId,
      });

      return responseHelper.success(res, "Calls fetched successfully", {
        calls: result.recordset || [],
      });
    } catch (err) {
      console.error("sp_FetchCalls error:", err);
      return responseHelper.error(res, "Failed to fetch calls");
    }
  },
};

module.exports = callController;
