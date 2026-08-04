// src/controllers/userBranchAccessController.js
const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { success, validationError } = require("../utils/responseHelper");
const {
  asyncRoute,
  firstRow,
  spStatus,
  spOk,
  spMessage,
  pageParams,
  positiveInt,
} = require("../utils/controllerKit");

class UserBranchAccessController {
  save = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        UserId: userIdInput,
        BranchId: branchIdInput,
        CanRead = true,
        CanWrite = false,
      } = req.body || {};

      const UserId = positiveInt(userIdInput);
      const BranchId = positiveInt(branchIdInput);

      if (!UserId || !BranchId) {
        return validationError(res, "UserId and BranchId are required");
      }

      const result = await database.executeStoredProcedure(
        "sp_SaveUserBranchAccess",
        {
          Id,
          UserId,
          BranchId,
          CanRead,
          CanWrite,
          CompId: req.user.CompId,
          CreatedBy: req.user.UserId,
        }
      );

      const sp = firstRow(result);
      const ok = spOk(sp);

      if (ok) {
        await logActivity({
          entityType: "UserBranchAccess",
          entityId: sp.Id ?? UserId,
          action: ACTIONS.PERMISSION_CHANGED,
          newValue: JSON.stringify({ UserId, BranchId, CanRead, CanWrite }),
          description: `Branch access ${Id === 0 ? "granted" : "updated"} for user ${UserId} on branch ${BranchId}`,
          req,
        });
      }
      return res.status(spStatus(sp)).json({
        success: ok,
        message: spMessage(sp),
        responseCode: spStatus(sp),
        data: ok ? { id: sp.Id } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save branch access",
    "USER_BRANCH_ACCESS_SAVE_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const { UserId: userIdInput, SearchTerm = null } = req.body || {};
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      const UserId = positiveInt(userIdInput);
      if (!UserId) return validationError(res, "UserId is required");

      const result = await database.executeStoredProcedure(
        "sp_FetchUserBranchAccess",
        { UserId, CompId: req.user.CompId, PageNumber, PageSize, SearchTerm }
      );

      // Envelope columns are optional on this one — a bare row set is still a
      // success, so seed a 200 rather than letting spStatus fall back to its
      // malformed-response 500.
      const header = { ResponseCode: 200, ...(firstRow(result) ?? {}) };
      const access = cleanSpRows(result.recordsets[0]);

      return res.status(spStatus(header)).json({
        success: spOk(header),
        message: spMessage(header),
        responseCode: spStatus(header),
        data: {
          branchAccess: access,
          pagination: {
            currentPage: header.CurrentPage ?? PageNumber,
            pageSize: header.PageSize ?? PageSize,
            totalRecords: header.TotalRecords ?? access.length,
            totalPages: header.TotalPages ?? 1,
          },
        },
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to fetch branch access",
    "USER_BRANCH_ACCESS_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      const Id = positiveInt((req.body || {}).Id);
      if (!Id) return validationError(res, "Id is required");

      // CompId, because the SP used to delete whatever row id it was handed.
      // Its siblings save/fetch both scoped by company; only delete was missed,
      // which let one company's admin strip another company's branch grants by
      // guessing ids.
      const result = await database.executeStoredProcedure(
        "sp_DeleteUserBranchAccess",
        { Id, CompId: req.user.CompId }
      );

      const sp = firstRow(result);
      if (spOk(sp)) {
        await logActivity({
          entityType: "UserBranchAccess",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Branch access revoked",
          req,
        });
      }
      return res.status(spStatus(sp)).json({
        success: spOk(sp),
        message: spMessage(sp),
        responseCode: spStatus(sp),
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to delete branch access",
    "USER_BRANCH_ACCESS_DELETE_ERROR",
  );

  // Convenience: caller's own scope summary (no admin permission needed).
  // No asyncRoute — there is nothing here that can throw, it just hands back
  // what loadScope already put on req.
  myScope(req, res) {
    return success(res, "Scope retrieved", req.scope || null);
  }
}

module.exports = new UserBranchAccessController();
