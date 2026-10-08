const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { asyncRoute, firstRow, spStatus, spOk, spMessage, positiveInt } = require("../utils/controllerKit");

// tblBranch has no CompId: tenant isolation is per database (CLAUDE.md §8), so CompId is passed but not a row filter.
class BranchController {
  // Create/edit an office. Id 0 inserts; the SP refuses a ParentId loop with a 400.
  saveBranch = asyncRoute(
    async (req, res) => {
      const { Id, BranchName, ParentId, Address, IsActive } = req.body;
      const result = await database.executeStoredProcedure("sp_SaveBranch", {
        Id: Number(Id) || 0,
        BranchName,
        ParentId: positiveInt(ParentId),
        Address: Address ?? null,
        IsActive: IsActive === false ? 0 : 1,
        CompId: req.user.CompId,
      });
      const row = firstRow(result);
      const ok = spOk(row);
      if (ok) {
        await logActivity({
          entityType: "Branch",
          entityId: row.Id,
          action: Number(Id) ? ACTIONS.UPDATED : ACTIONS.CREATED,
          description: `Office "${BranchName}" ${Number(Id) ? "updated" : "created"}`,
          req,
        });
      }
      return res.status(spStatus(row)).json({
        success: ok,
        message: spMessage(row),
        responseCode: spStatus(row),
        data: ok ? { id: row.Id } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save office",
    "BRANCH_SAVE_ERROR",
  );
}

module.exports = new BranchController();
