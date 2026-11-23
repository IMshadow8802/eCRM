const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { assertRecordAccess } = require("../middleware/permission");
const { actor } = require("../utils/actor");

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
    const { CompId, UserId } = actor(req);
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
    // Level "write": the route is open(), so this is the only edit gate.
    if (!(await assertRecordAccess(req, res, entity, LeadId ?? TicketId, "write"))) return;
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

  /**
   * Fetches the calls of one lead or one ticket, gated on visibility the same
   * way logCall is: asking for another branch's lead by id must not hand back
   * its call history, which includes free-text notes.
   *
   * There is no "my own calls" listing any more (final review m4): it returned
   * notes and ids of records that had since left the caller (D8: such activity
   * stays in your numbers, it is not listed), and no client asked for it.
   */
  async fetchCalls(req, res) {
    const { LeadId = null, TicketId = null } = req.body || {};
    if (!LeadId && !TicketId) {
      return responseHelper.validationError(res, "LeadId or TicketId is required");
    }
    try {
      const { CompId, UserId } = actor(req);
      if (LeadId && !(await assertRecordAccess(req, res, "lead", LeadId))) return;
      if (!LeadId && !(await assertRecordAccess(req, res, "ticket", TicketId))) return;

      const result = await database.executeStoredProcedure("sp_FetchCalls", {
        CompId,
        LeadId,
        TicketId,
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
