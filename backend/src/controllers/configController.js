const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { positiveInt } = require("../utils/controllerKit");

// Audit descriptors for config-engine mutations (who changed the custom
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

  // Explicit list, not `...req.body`: sp_SaveLookup declares exactly these, and
  // node-mssql sends every key it is given — a stray one is a hard error from
  // SQL Server, not an ignored extra. TatHours (spec 2 §1) is hours-per-priority
  // on Kind='priority'; 0 / blank / junk → NULL, which the SP reads as "no TAT,
  // never overdue". The Code rule for ticket_status lives in the SP.
  saveLookup(req, res) {
    const { CompId } = req.user;
    const { Id = 0, Kind, Value, SortOrder = 0, Code = null, TatHours = null } = req.body;
    return runSp(
      res,
      "sp_SaveLookup",
      {
        Id: Number(Id) || 0,
        CompId,
        Kind,
        Value,
        SortOrder: Number(SortOrder) || 0,
        Code: Code || null,
        TatHours: positiveInt(TatHours),
      },
      "Failed to save lookup",
      req,
      saveLog(req, "Lookup", "Lookup"),
    );
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
