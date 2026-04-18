const express = require("express");
const leadSourceController = require("../controllers/leadSourceController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveSources", requirePayload, leadSourceController.save);
router.post("/fetchSources", allowEmptyPayload, leadSourceController.fetch);
router.post("/deleteSources", requirePayload, leadSourceController.delete);

module.exports = router;
