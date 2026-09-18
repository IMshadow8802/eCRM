const express = require("express");
const ticketController = require("../controllers/ticketController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// loadScope populates req.scope: the fetch SPs filter on it, the write actions
// gate on it (assertRecordAccess / assertCanAssign / canReopen). No
// requireAdmin here — complaints are worked by agents; the record and target
// gates in the controller do the authorising.
router.use(verifyToken, loadScope);

router.post("/saveTicket", requirePayload, ticketController.save);
router.post("/fetchTickets", allowEmptyPayload, ticketController.fetch);
router.post("/fetchTicketDetail", requirePayload, ticketController.detail);
// Lifecycle (spec 2 §2): one engine and four shortcuts into it.
router.post("/setTicketStatus", requirePayload, ticketController.setStatus);
router.post("/resolveTicket", requirePayload, ticketController.resolve);
router.post("/closeTicket", requirePayload, ticketController.close);
router.post("/rejectTicket", requirePayload, ticketController.reject);
router.post("/reopenTicket", requirePayload, ticketController.reopen);
// Ownership and escalation.
router.post("/transferTicket", requirePayload, ticketController.transfer);
router.post("/bulkTransferTickets", requirePayload, ticketController.bulkTransfer);
router.post("/escalateTicket", requirePayload, ticketController.escalate);
// ForUserId is optional (defaults to the caller), so an empty body is legal.
router.post("/fetchEscalationTargets", allowEmptyPayload, ticketController.escalationTargets);
router.post("/deleteTicket", requirePayload, ticketController.delete);

module.exports = router;
