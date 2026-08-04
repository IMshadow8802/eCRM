const database = require("../config/database");
const { scopeJson } = require("../middleware/permission");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");
const { validationError } = require("../utils/responseHelper");
const {
  asyncRoute,
  firstRow,
  spStatus,
  spOk,
  spMessage,
  pageParams,
  positiveInt,
} = require("../utils/controllerKit");

class TeamController {
  save = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        Name,
        Description,
        LeadUserId,
        Color,
        Members, // Array of user IDs. NO default — see below.
        IsActive = true,
      } = req.body;

      /**
       * Three states, not two. sp_SaveTeam replaces the whole roster and
       * cascades that into every linked project workspace, so "the caller said
       * nothing about members" and "the caller wants no members" cannot share a
       * value:
       *
       *   absent      -> null    leave the roster alone
       *   []          -> '[]'    clear it, deliberately
       *   [1, 2]      -> '[1,2]' replace it
       *
       * This used to default Members to `[]` and map both `[]` and a missing
       * key to null, which the SP read as "no opinion" — while still running an
       * unconditional DELETE first. So renaming a team deleted every member and
       * soft-removed them from its project workspaces. The web form only
       * escaped it by posting the full array back every time.
       *
       * Anything that is not an array (a string, an object, junk) is treated as
       * absent rather than as a clear: refusing to touch the roster is the safe
       * reading of an input we do not understand.
       */
      const membersJson = Array.isArray(Members) ? JSON.stringify(Members) : null;

      const result = await database.executeStoredProcedure("sp_SaveTeam", {
        Id,
        Name,
        Description,
        LeadUserId,
        Color,
        Members: membersJson,
        IsActive,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);

      if (ok && spResponse.TeamId) {
        await logActivity({
          entityType: "Team",
          entityId: spResponse.TeamId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Team ${Name || ""} ${Id === 0 ? "created" : "updated"} (${spResponse.MemberCount || 0} members)`,
          req,
        });
      }

      return res.status(spStatus(spResponse)).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: ok
          ? {
              teamId: spResponse.TeamId,
              memberCount: spResponse.MemberCount || 0
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save team",
    "TEAM_SAVE_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const { Id = 0, SearchTerm = null } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 10);

      // scopeJson, not `?.length ? stringify : null`. That form collapses an
      // empty scope to NULL, which every one of these SPs reads as "apply no
      // branch filter at all" — the widest possible answer for the narrowest
      // possible scope. '[]' is an empty allow-list and matches nothing.
      const accessibleBranchIdsJson = scopeJson(req.scope?.branchIds);

      const result = await database.executeStoredProcedure("sp_FetchTeam", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = firstRow(result);

      // Strip envelope + placeholder rows, then parse the Members JSON column.
      const teams = cleanSpRows(result.recordsets[0]).map((team) => {
        const { Members, ...rest } = team;
        let parsedMembers = [];
        if (Members) {
          try {
            parsedMembers = JSON.parse(Members);
          } catch (err) {
            console.warn("Failed to parse Members JSON:", err);
          }
        }
        return { ...rest, Members: parsedMembers };
      });

      return res.status(spStatus(spResponse)).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: {
          teams: teams,
          pagination: {
            currentPage: spResponse?.CurrentPage,
            pageSize: spResponse?.PageSize,
            totalRecords: spResponse?.TotalRecords,
            totalPages: spResponse?.TotalPages,
          },
        },
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to fetch teams",
    "TEAM_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      const Id = positiveInt(req.body.Id);

      if (!Id) return validationError(res, "Team ID is required");

      const result = await database.executeStoredProcedure("sp_DeleteTeam", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
      });

      const spResponse = firstRow(result);

      if (spOk(spResponse)) {
        await logActivity({
          entityType: "Team",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Team deleted",
          req,
        });
      }

      return res.status(spStatus(spResponse)).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to delete team",
    "TEAM_DELETE_ERROR",
  );
}

module.exports = new TeamController();
