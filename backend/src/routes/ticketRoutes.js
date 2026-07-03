const express = require("express");
const ticketController = require("../controllers/ticketController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveTicket", requirePayload, ticketController.save);
router.post("/fetchTickets", allowEmptyPayload, ticketController.fetch);
router.post("/fetchTicketDetail", requirePayload, ticketController.detail);
router.post("/moveTicketStage", requirePayload, ticketController.moveStage);
router.post("/resolveTicket", requirePayload, ticketController.resolve);
router.post("/closeTicket", requirePayload, ticketController.close);
router.post("/reopenTicket", requirePayload, ticketController.reopen);
router.post("/deleteTicket", requirePayload, ticketController.delete);
router.post("/saveSLARule", requirePayload, ticketController.saveSLARule);
router.post("/fetchSLARules", allowEmptyPayload, ticketController.fetchSLARules);

module.exports = router;
