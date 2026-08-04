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

class ProjectController {
  save = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        Name,
        Description,
        ManagerUserId,
        TeamId,
        Members,
        Status = "active",
        Priority = "medium",
        StartDate,
        EndDate,
        Budget = 0,
        Progress = 0,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveProject", {
        Id,
        Name,
        Description,
        ManagerUserId,
        TeamId,
        Members:
          typeof Members === "object" ? JSON.stringify(Members) : Members,
        Status,
        Priority,
        StartDate,
        EndDate,
        Budget,
        Progress,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);

      if (ok && spResponse.ProjectId) {
        await logActivity({
          entityType: "Project",
          entityId: spResponse.ProjectId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Project ${Name || ""} ${Id === 0 ? "created" : "updated"}`,
          req,
        });
      }

      return res.status(spStatus(spResponse)).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: ok ? { projectId: spResponse.ProjectId } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save project",
    "PROJECT_SAVE_ERROR",
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

      const result = await database.executeStoredProcedure("sp_FetchProject", {
        Id,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = firstRow(result);

      // Drop envelope fields and the empty-result placeholder row.
      const projects = cleanSpRows(result.recordsets[0]);

      return res.status(spStatus(spResponse)).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: {
          projects: projects,
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
    "Failed to fetch projects",
    "PROJECT_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      const Id = positiveInt(req.body.Id);

      if (!Id) return validationError(res, "Project ID is required");

      const result = await database.executeStoredProcedure("sp_DeleteProject", {
        Id,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
      });

      const spResponse = firstRow(result);

      if (spOk(spResponse)) {
        await logActivity({
          entityType: "Project",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Project deleted",
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
    "Failed to delete project",
    "PROJECT_DELETE_ERROR",
  );
}

module.exports = new ProjectController();
