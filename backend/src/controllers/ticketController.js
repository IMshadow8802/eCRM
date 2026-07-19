const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const attachmentController = require("./attachmentController");
const { scopeParams, canSeeRecord } = require("../middleware/permission");

// Mutating SPs log their own activity server-side and return one status row.
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

const ticketController = {
  save(req, res) {
    const { CompId, BranchId, UserId } = req.user;
    const { Id = 0 } = req.body;
    return runSp(
      res,
      "sp_SaveTicket",
      { ...req.body, Id, CompId, BranchId, UserId },
      "Failed to save ticket",
    );
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const {
        // BranchId is an optional UI filter now — it narrows within scope and
        // never widens it. Visibility comes from req.scope; passing
        // req.user.BranchId here is what hid every out-of-branch row.
        BranchId = null,
        PageNumber = 1,
        PageSize = 10,
        SearchTerm = null,
        StageId = null,
        Priority = null,
        CategoryId = null,
        AssignedTo = null,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_FetchTickets", {
        CompId,
        BranchId,
        PageNumber,
        PageSize,
        SearchTerm,
        StageId,
        Priority,
        CategoryId,
        AssignedTo,
        ...scopeParams(req),
      });

      const tickets = result.recordsets[0] || [];
      const pagination = (result.recordsets[1] && result.recordsets[1][0]) || {};

      return responseHelper.success(res, "Tickets fetched successfully", {
        tickets,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? tickets.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchTickets error:", err);
      return responseHelper.error(res, "Failed to fetch tickets");
    }
  },

  async detail(req, res) {
    try {
      const { CompId } = req.user;
      const { TicketId } = req.body;

      const result = await database.executeStoredProcedure("sp_FetchTicketDetail", {
        CompId,
        TicketId,
      });

      const ticket = (result.recordsets[0] && result.recordsets[0][0]) || null;

      // The detail SP is CompId-scoped only, so gate the row here. 404 rather
      // than 403: a user who cannot see a ticket should not learn it exists.
      if (!canSeeRecord(req, ticket, "AssignedTo")) {
        return responseHelper.error(
          res,
          "Ticket not found",
          "NOT_FOUND",
          404,
        );
      }

      const fields = result.recordsets[1] || [];
      const activity = result.recordsets[2] || [];
      const linkedLead = (result.recordsets[3] && result.recordsets[3][0]) || null;

      return responseHelper.success(res, "Ticket detail fetched successfully", {
        ticket,
        fields,
        activity,
        linkedLead,
      });
    } catch (err) {
      console.error("sp_FetchTicketDetail error:", err);
      return responseHelper.error(res, "Failed to fetch ticket detail");
    }
  },

  moveStage(req, res) {
    const { CompId, UserId } = req.user;
    // ResolutionId rides along for drags into a won stage — the SP requires a
    // resolution on first entry (stage is the lifecycle's source of truth).
    const { TicketId, StageId, ResolutionId = null } = req.body;
    return runSp(
      res,
      "sp_MoveTicketStage",
      { CompId, TicketId, StageId, UserId, ResolutionId },
      "Failed to move ticket stage",
    );
  },

  resolve(req, res) {
    const { CompId, UserId } = req.user;
    const { TicketId, ResolutionId } = req.body;
    return runSp(
      res,
      "sp_ResolveTicket",
      { CompId, TicketId, ResolutionId, UserId },
      "Failed to resolve ticket",
    );
  },

  close(req, res) {
    const { CompId, UserId } = req.user;
    const { TicketId } = req.body;
    return runSp(res, "sp_CloseTicket", { CompId, TicketId, UserId }, "Failed to close ticket");
  },

  reopen(req, res) {
    const { CompId, UserId } = req.user;
    const { TicketId } = req.body;
    return runSp(res, "sp_ReopenTicket", { CompId, TicketId, UserId }, "Failed to reopen ticket");
  },

  async delete(req, res) {
    const { CompId } = req.user;
    const { Id } = req.body;
    try {
      const result = await database.executeStoredProcedure("sp_DeleteTicket", { Id, CompId });
      const spResponse = result.recordset[0];
      const message = spResponse.ResponseMess || spResponse.ResponseMessage;
      if (spResponse.ResponseCode === 200) {
        await attachmentController.cascadeDelete(CompId, "ticket", Id);
        return responseHelper.success(res, message, spResponse);
      }
      return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
    } catch (err) {
      console.error("sp_DeleteTicket error:", err);
      return responseHelper.error(res, "Failed to delete ticket");
    }
  },

};

module.exports = ticketController;
