const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { logActivity, ACTIONS } = require("../utils/activityLogger");

// Audit descriptors for config-engine mutations (who changed the pipeline /
// fields / lookups, when). save = Created/Updated by Id; delete = Deleted.
const saveLog = (req, entityType, label) => {
  const isNew = (Number(req.body.Id) || 0) === 0;
  return {
    entityType,
    action: isNew ? ACTIONS.CREATED : ACTIONS.UPDATED,
    entityId: Number(req.body.Id) || 0,
    description: `${label} ${isNew ? "created" : "updated"}`,
  };
};
const delLog = (req, entityType, label) => ({
  entityType,
  action: ACTIONS.DELETED,
  entityId: Number(req.body.Id) || 0,
  description: `${label} deleted`,
});

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
// Optional (req, log) fire an audit entry to tblActivityLog on success.
async function runSp(res, spName, params, failMessage, req, log) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;

    if (spResponse.ResponseCode === 200) {
      if (req && log) {
        await logActivity({
          entityType: log.entityType,
          entityId: spResponse.Id ?? log.entityId ?? 0,
          action: log.action,
          description: log.description,
          req,
        });
      }
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
    return runSp(res, "sp_SaveCustomField", { ...req.body, CompId, CreatedBy: UserId }, "Failed to save custom field", req, saveLog(req, "CustomField", "Custom field"));
  },

  fetchCustomFields(req, res) {
    const { CompId } = req.user;
    return fetchRows(res, "sp_FetchCustomFields", { CompId, Entity: req.body.Entity }, "customFields");
  },

  deleteCustomField(req, res) {
    const { CompId } = req.user;
    return runSp(res, "sp_DeleteCustomField", { ...req.body, CompId }, "Failed to delete custom field", req, delLog(req, "CustomField", "Custom field"));
  },

  savePipeline(req, res) {
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_SavePipeline", { ...req.body, CompId, CreatedBy: UserId }, "Failed to save pipeline", req, saveLog(req, "Pipeline", "Pipeline"));
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
    return runSp(res, "sp_SaveStage", { ...req.body, CompId, CreatedBy: UserId }, "Failed to save stage", req, saveLog(req, "PipelineStage", "Stage"));
  },

  deleteStage(req, res) {
    const { CompId } = req.user;
    return runSp(res, "sp_DeleteStage", { ...req.body, CompId }, "Failed to delete stage", req, delLog(req, "PipelineStage", "Stage"));
  },

  saveLookup(req, res) {
    const { CompId, UserId } = req.user;
    return runSp(res, "sp_SaveLookup", { ...req.body, CompId, CreatedBy: UserId }, "Failed to save lookup", req, saveLog(req, "Lookup", "Lookup"));
  },

  fetchLookups(req, res) {
    const { CompId } = req.user;
    return fetchRows(res, "sp_FetchLookups", { CompId, Kind: req.body.Kind }, "lookups");
  },

  deleteLookup(req, res) {
    const { CompId } = req.user;
    return runSp(res, "sp_DeleteLookup", { ...req.body, CompId }, "Failed to delete lookup", req, delLog(req, "Lookup", "Lookup"));
  },
};

module.exports = { configController };
