const express = require("express");
const c = require("../controllers/todayController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, open } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Scope is the attendance reach, applied in the controller (teamIds).
router.post("/mine", allowEmptyPayload, open(), c.mine);
router.post("/team", allowEmptyPayload, open(), c.team);
router.post("/teamSize", allowEmptyPayload, open(), c.teamSize);
router.post("/personTasks", requirePayload, open(), c.personTasks);

module.exports = router;
