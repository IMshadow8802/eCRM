const express = require("express");
const reportController = require("../controllers/reportController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { allowEmptyPayload, requirePayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/getDashboard", allowEmptyPayload, reportController.getDashboard);
router.post("/getConvertedSummary", allowEmptyPayload, reportController.getConvertedSummary);
router.post("/getFollowupsUserWise", allowEmptyPayload, reportController.getFollowupsUserWise);
router.post("/getLeadSummaryBranchWise", allowEmptyPayload, reportController.getLeadSummaryBranchWise);
router.post("/pipelineFunnel", allowEmptyPayload, reportController.pipelineFunnel);
router.post("/callsPerUser", allowEmptyPayload, reportController.callsPerUser);
router.post("/conversionBySource", allowEmptyPayload, reportController.conversionBySource);
router.post("/slaBreachSummary", allowEmptyPayload, reportController.slaBreachSummary);
router.post("/ticketsByCategory", allowEmptyPayload, reportController.ticketsByCategory);
router.post("/resolutionSummary", allowEmptyPayload, reportController.resolutionSummary);

module.exports = router;
