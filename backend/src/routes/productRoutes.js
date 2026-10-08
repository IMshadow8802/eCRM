const express = require("express");
const productController = require("../controllers/productController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, open, saveAction } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();
router.use(verifyToken, loadScope);

// The master is company config: writes need the settings module; everyone reads
// it for pick-lists.
router.post("/saveProduct", requirePayload, requireModule("settings", saveAction), productController.save);
router.post("/fetchProducts", allowEmptyPayload, open(), productController.fetch);
router.post("/deleteProduct", requirePayload, requireModule("settings", "delete"), productController.delete);

module.exports = router;
