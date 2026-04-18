const express = require("express");
const userController = require("../controllers/userController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveUser", requirePayload, userController.save);
router.post("/fetchUsers", allowEmptyPayload, userController.fetch);
router.post("/deleteUser", requirePayload, userController.delete);

module.exports = router;
