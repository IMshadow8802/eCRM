const express = require("express");
const statusController = require("../controllers/statusController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveStatus", requirePayload, statusController.save);
router.post("/fetchStatus", allowEmptyPayload, statusController.fetch);
router.post("/deleteStatus", requirePayload, statusController.delete);

module.exports = router;
