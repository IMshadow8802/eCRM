const express = require("express");
const customerController = require("../controllers/customerController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// loadScope populates req.scope; fetchCustomerDetail passes it on so RS2 (the
// customer's complaints) is narrowed to what the caller may see.
router.use(verifyToken, loadScope);

// Read + write open to every authenticated user of the company (spec 2 §3):
// the agent typing a mobile at the counter is the one who creates the row.
router.post("/saveCustomer", requirePayload, customerController.save);
router.post("/fetchCustomers", allowEmptyPayload, customerController.fetch);
router.post("/fetchCustomerDetail", requirePayload, customerController.detail);
// Delete is an admin act — it soft-deletes a row other agents' complaints hang off.
router.post("/deleteCustomer", requireAdmin, requirePayload, customerController.delete);

module.exports = router;
