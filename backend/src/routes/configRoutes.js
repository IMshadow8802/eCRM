const express = require("express");
const { configController } = require("../controllers/configController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, open, saveAction } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

/**
 * Writes need the settings module (add/edit/delete); reads are open.
 *
 * These endpoints rewrite company-wide configuration — the custom fields every
 * form renders and the lookup vocabularies (statuses, priorities and their TAT,
 * channels, reasons). None of it was guarded once, so any authenticated
 * employee could do all of it.
 *
 * The fetches stay open because every screen reads them — a complaint form
 * needs its statuses and channels, a lead form its sources.
 *
 * The pipeline routes (savePipeline / fetchPipelines / saveStage / deleteStage)
 * went with the pipeline engine in 086; tickets were its last user.
 */
router.post("/saveCustomField", requirePayload, requireModule("settings", saveAction), configController.saveCustomField);
router.post("/fetchCustomFields", allowEmptyPayload, open(), configController.fetchCustomFields);
router.post("/deleteCustomField", requirePayload, requireModule("settings", "delete"), configController.deleteCustomField);
router.post("/saveLookup", requirePayload, requireModule("settings", saveAction), configController.saveLookup);
router.post("/fetchLookups", allowEmptyPayload, open(), configController.fetchLookups);
router.post("/deleteLookup", requirePayload, requireModule("settings", "delete"), configController.deleteLookup);

module.exports = router;
