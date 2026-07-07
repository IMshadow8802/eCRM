const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");

// Save-type SP: returns a single row with ResponseCode/ResponseMess.
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

const callController = {
  // Logs a call against a lead OR a ticket (exactly one of LeadId/TicketId set).
  logCall(req, res) {
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
