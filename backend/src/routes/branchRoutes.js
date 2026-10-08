const express = require("express");
const branchController = require("../controllers/branchController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireAdmin } = require("../middleware/permission");
const { requirePayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Offices are company structure: admin only. The office pick-list is read via users/fetchBranches.
router.post("/saveBranch", requirePayload, requireAdmin, branchController.saveBranch);

module.exports = router;
