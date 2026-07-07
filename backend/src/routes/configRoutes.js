const express = require("express");
const { configController } = require("../controllers/configController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveCustomField", requirePayload, configController.saveCustomField);
router.post("/fetchCustomFields", allowEmptyPayload, configController.fetchCustomFields);
router.post("/deleteCustomField", requirePayload, configController.deleteCustomField);
router.post("/savePipeline", requirePayload, configController.savePipeline);
router.post("/fetchPipelines", allowEmptyPayload, configController.fetchPipelines);
router.post("/saveStage", requirePayload, configController.saveStage);
router.post("/deleteStage", requirePayload, configController.deleteStage);
router.post("/saveLookup", requirePayload, configController.saveLookup);
router.post("/fetchLookups", allowEmptyPayload, configController.fetchLookups);
router.post("/deleteLookup", requirePayload, configController.deleteLookup);

module.exports = router;
