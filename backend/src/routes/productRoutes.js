const express = require("express");
const productController = require("../controllers/productController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireMinLevel, HIERARCHY } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();
router.use(verifyToken, loadScope);

// The master is company config: Owner, Admin and the department heads
// (HierarchyLevel <= 2) maintain it; everyone reads it for pick-lists.
router.post("/saveProduct", requireMinLevel(HIERARCHY.ADMIN), requirePayload, productController.save);
router.post("/fetchProducts", allowEmptyPayload, productController.fetch);
router.post("/deleteProduct", requireMinLevel(HIERARCHY.ADMIN), requirePayload, productController.delete);

module.exports = router;
