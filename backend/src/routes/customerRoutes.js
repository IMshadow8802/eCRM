const express = require("express");
const customerController = require("../controllers/customerController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, saveAction, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// Governed by the customers module (delete is admin-only). loadScope populates
// req.scope; fetchCustomerDetail passes it on so RS2 (the customer's complaints)
// is narrowed to what the caller may see.
router.use(verifyToken, loadScope);

router.post("/saveCustomer", requirePayload, requireModule("customers", saveAction), customerController.save);
router.post("/fetchCustomers", allowEmptyPayload, requireModule("customers", "view"), customerController.fetch);
router.post("/fetchCustomerDetail", requirePayload, requireModule("customers", "view"), customerController.detail);
// Delete is an admin act — it soft-deletes a row other agents' complaints hang off.
router.post("/deleteCustomer", requirePayload, requireAdmin, customerController.delete);

module.exports = router;
