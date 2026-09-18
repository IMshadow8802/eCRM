const express = require("express");
const { configController } = require("../controllers/configController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

/**
 * Writes are admin-only; reads are not.
 *
 * These endpoints rewrite company-wide configuration — the custom fields every
 * form renders and the lookup vocabularies (statuses, priorities and their TAT,
 * channels, reasons). None of it was guarded once, so any authenticated
 * employee could do all of it.
 *
 * Admin is the right gate rather than a guess: in tblGroupAccess only Owner and
 * Admin hold any /settings/* grant, and both carry IsAdmin. This matches the
 * access model that already exists in the data; it does not invent a new one.
 *
 * The fetches stay open because every screen reads them — a complaint form
 * needs its statuses and channels, a lead form its sources.
 *
 * The pipeline routes (savePipeline / fetchPipelines / saveStage / deleteStage)
 * went with the pipeline engine in 086; tickets were its last user.
 */
router.post("/saveCustomField", requireAdmin, requirePayload, configController.saveCustomField);
router.post("/fetchCustomFields", allowEmptyPayload, configController.fetchCustomFields);
router.post("/deleteCustomField", requireAdmin, requirePayload, configController.deleteCustomField);
router.post("/saveLookup", requireAdmin, requirePayload, configController.saveLookup);
router.post("/fetchLookups", allowEmptyPayload, configController.fetchLookups);
router.post("/deleteLookup", requireAdmin, requirePayload, configController.deleteLookup);

module.exports = router;
