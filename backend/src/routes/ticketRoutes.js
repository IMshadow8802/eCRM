const express = require("express");
const ticketController = require("../controllers/ticketController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, saveAction } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// Governed by the complaints module: view / add+edit (saveAction) / edit / delete
// per route. Per-row authorising is the database's (132/133: visibility, CanEdit,
// reassign / reopen / send-back gates); the controller relays its answers.
router.use(verifyToken, loadScope);

router.post("/saveTicket", requirePayload, requireModule("complaints", saveAction), ticketController.save);
router.post("/fetchTickets", allowEmptyPayload, requireModule("complaints", "view"), ticketController.fetch);
router.post("/fetchTicketDetail", requirePayload, requireModule("complaints", "view"), ticketController.detail);
// Lifecycle (spec 2 §2): one engine and four shortcuts into it.
router.post("/setTicketStatus", requirePayload, requireModule("complaints", "edit"), ticketController.setStatus);
router.post("/resolveTicket", requirePayload, requireModule("complaints", "edit"), ticketController.resolve);
router.post("/closeTicket", requirePayload, requireModule("complaints", "edit"), ticketController.close);
router.post("/rejectTicket", requirePayload, requireModule("complaints", "edit"), ticketController.reject);
router.post("/reopenTicket", requirePayload, requireModule("complaints", "edit"), ticketController.reopen);
// Ownership and escalation.
router.post("/transferTicket", requirePayload, requireModule("complaints", "edit"), ticketController.transfer);
router.post("/bulkTransferTickets", requirePayload, requireModule("complaints", "edit"), ticketController.bulkTransfer);
router.post("/escalateTicket", requirePayload, requireModule("complaints", "edit"), ticketController.escalate);
// TicketId (new) or ForUserId (old clients); neither = the caller, so an empty body is legal.
router.post("/fetchEscalationTargets", allowEmptyPayload, requireModule("complaints", "view"), ticketController.escalationTargets);
// Complaints the caller logged, wherever they are now. Search and paging optional.
router.post("/fetchLoggedByMe", allowEmptyPayload, requireModule("complaints", "view"), ticketController.loggedByMe);
router.post("/deleteTicket", requirePayload, requireModule("complaints", "delete"), ticketController.delete);

module.exports = router;
