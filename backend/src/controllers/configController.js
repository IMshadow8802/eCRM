const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");

// Fetch-type SPs: return a flat recordset of rows, always 200.
async function fetchRows(res, spName, params, dataKey) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    return responseHelper.success(res, `${dataKey} fetched successfully`, {
      [dataKey]: result.recordset || [],
    });
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, `Failed to fetch ${dataKey}`);
  }
}

// Save/delete-type SPs: return a single row with ResponseCode/ResponseMess.
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

const configController = {
  saveCustomField(req, res) {
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_SaveCustomField", { ...req.body, CompId, CreatedBy: UserId }, "Failed to save custom field");
  },

  fetchCustomFields(req, res) {
    const { CompId } = req.user;
    return fetchRows(res, "sp_FetchCustomFields", { CompId, Entity: req.body.Entity }, "customFields");
  },

  deleteCustomField(req, res) {
    const { CompId } = req.user;
    return runSp(res, "sp_DeleteCustomField", { ...req.body, CompId }, "Failed to delete custom field");
  },

  savePipeline(req, res) {
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_SavePipeline", { ...req.body, CompId, CreatedBy: UserId }, "Failed to save pipeline");
  },

  // sp_FetchPipelines returns 2 result sets (pipelines, then their stages);
  // both are forwarded so the board/settings can group stages by PipelineId.
  async fetchPipelines(req, res) {
    const { CompId } = req.user;
    try {
      const result = await database.executeStoredProcedure("sp_FetchPipelines", {
        CompId,
        Entity: req.body.Entity,
      });
      return responseHelper.success(res, "pipelines fetched successfully", {
        pipelines: result.recordsets?.[0] || result.recordset || [],
        stages: result.recordsets?.[1] || [],
      });
    } catch (err) {
      console.error("sp_FetchPipelines error:", err);
      return responseHelper.error(res, "Failed to fetch pipelines");
    }
  },

  saveStage(req, res) {
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_SaveStage", { ...req.body, CompId, CreatedBy: UserId }, "Failed to save stage");
  },

  deleteStage(req, res) {
    const { CompId } = req.user;
    return runSp(res, "sp_DeleteStage", { ...req.body, CompId }, "Failed to delete stage");
  },

  saveLookup(req, res) {
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_SaveLookup", { ...req.body, CompId, CreatedBy: UserId }, "Failed to save lookup");
  },

  fetchLookups(req, res) {
    const { CompId } = req.user;
    return fetchRows(res, "sp_FetchLookups", { CompId, Kind: req.body.Kind }, "lookups");
  },

  deleteLookup(req, res) {
    const { CompId } = req.user;
    return runSp(res, "sp_DeleteLookup", { ...req.body, CompId }, "Failed to delete lookup");
  },
};

module.exports = { configController };
