const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");

class LeadController {
  async save(req, res) {
    try {
      const {
        Id = 0,
        LeadDate = null,
        CustomerName = null,
        MobileNo,
        AlternateMobile = null,
        Email = null,
        Address = null,
        LeadSource = null,
        ProductCategory = null,
        ProductBrand = null,
        ProductModel = null,
        Budget = null,
        LeadStatus = null,
        FollowupDate = null,
        Remarks = null,
        AssignTo = null,
        AssignedDate = null,
        InvoiceDate = null,
        InvoiceNo = null,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveLead", {
        Id,
        BranchId: req.user.BranchId,
        CompId: req.user.CompId,
        LeadDate,
        CustomerName,
        MobileNo,
        AlternateMobile,
        Email,
        Address,
        LeadSource,
        ProductCategory,
        ProductBrand,
        ProductModel,
        Budget,
        LeadStatus,
        FollowupDate,
        Remarks,
        AssignTo,
        AssignedDate,
        InvoiceDate,
        InvoiceNo,
        CreatedBy: req.user.UserId,
        EditBy: req.user.UserId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300 && spResponse.Id) {
        await logActivity({
          entityType: "Lead",
          entityId: spResponse.Id,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description:
            Id === 0
              ? `Lead created for ${CustomerName || "(no name)"}`
              : `Lead updated`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMessage,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? { leadId: spResponse.Id }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save lead error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save lead",
        code: "LEAD_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      const {
        Id = 0,
        PageNumber = 1,
        PageSize = 10,
        SearchTerm = null,
      } = req.body;

      // Pass scope-derived branch list when middleware loaded it; SP
      // falls back to single-BranchId filter when null.
      const accessibleBranchIdsJson = req.scope?.branchIds?.length
        ? JSON.stringify(req.scope.branchIds)
        : null;

      const result = await database.executeStoredProcedure("sp_FetchLeads", {
        Id,
        BranchId: req.user.BranchId,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = result.recordsets[0][0];
      const leads = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          leads,
          pagination: {
            currentPage: spResponse.CurrentPage,
            pageSize: spResponse.PageSize,
            totalRecords: spResponse.TotalRecords,
            totalPages: spResponse.TotalPages,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch lead error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch leads",
        code: "LEAD_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async transfer(req, res) {
    try {
      const { LeadId, ToBranchId, ToAssignToUserId = null, Reason = null } =
        req.body || {};

      if (!LeadId || !ToBranchId) {
        return res.status(400).json({
          success: false,
          message: "LeadId and ToBranchId are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_TransferLead", {
        LeadId,
        ToBranchId,
        ToAssignToUserId,
        CompId: req.user.CompId,
        TransferredByUserId: req.user.UserId,
        Reason,
      });

      const sp = result.recordsets[0][0];

      if (sp.ResponseCode === 200) {
        await logActivity({
          entityType: "Lead",
          entityId: sp.LeadId,
          action: ACTIONS.TRANSFERRED,
          fieldName: "BranchId",
          oldValue: sp.FromBranchId,
          newValue: sp.ToBranchId,
          description: Reason
            ? `Transferred from branch ${sp.FromBranchId} to ${sp.ToBranchId} — ${Reason}`
            : `Transferred from branch ${sp.FromBranchId} to ${sp.ToBranchId}`,
          req,
        });
      }

      return res.status(sp.ResponseCode).json({
        success: sp.ResponseCode === 200,
        message: sp.ResponseMess,
        responseCode: sp.ResponseCode,
        data:
          sp.ResponseCode === 200
            ? {
                leadId: sp.LeadId,
                fromBranchId: sp.FromBranchId,
                toBranchId: sp.ToBranchId,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Transfer lead error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to transfer lead",
        code: "LEAD_TRANSFER_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async delete(req, res) {
    try {
      const { Id } = req.body;

      const result = await database.executeStoredProcedure("sp_DeleteLead", {
        Id,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "Lead",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Lead deleted",
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMessage,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete lead error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete lead",
        code: "LEAD_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new LeadController();
