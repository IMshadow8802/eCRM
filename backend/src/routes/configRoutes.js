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
 * These endpoints rewrite company-wide configuration — the pipelines every
 * board is drawn from, the stages leads and tickets move through, the lookup
 * vocabularies. Deleting a stage out from under a live pipeline is a
 * company-wide event. None of it was guarded, so any authenticated employee
 * could do all of it.
 *
 * Admin is the right gate rather than a guess: in tblGroupAccess only Owner and
 * Admin hold any /settings/* grant, and both carry IsAdmin. This matches the
 * access model that already exists in the data; it does not invent a new one.
 *
 * The fetches stay open because every screen reads them — a lead form needs its
 * lookups, a board needs its stages.
 */
router.post("/saveCustomField", requireAdmin, requirePayload, configController.saveCustomField);
router.post("/fetchCustomFields", allowEmptyPayload, configController.fetchCustomFields);
router.post("/deleteCustomField", requireAdmin, requirePayload, configController.deleteCustomField);
router.post("/savePipeline", requireAdmin, requirePayload, configController.savePipeline);
router.post("/fetchPipelines", allowEmptyPayload, configController.fetchPipelines);
router.post("/saveStage", requireAdmin, requirePayload, configController.saveStage);
router.post("/deleteStage", requireAdmin, requirePayload, configController.deleteStage);
router.post("/saveLookup", requireAdmin, requirePayload, configController.saveLookup);
router.post("/fetchLookups", allowEmptyPayload, configController.fetchLookups);
router.post("/deleteLookup", requireAdmin, requirePayload, configController.deleteLookup);

module.exports = router;
