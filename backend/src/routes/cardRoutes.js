// src/routes/cardRoutes.js — /api/Card/*, the paths the VisiScan app calls (JRS contract, capital C).
const express = require("express");
const c = require("../controllers/cardController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();
router.use(verifyToken, loadScope);

// saveCard is multipart: no payload check, the controller reads the stream itself.
router.post("/saveCard", requireModule("cards", "add"), c.saveCard);
router.post("/fetchCard", allowEmptyPayload, requireModule("cards", "view"), c.fetchCard);
router.post("/deleteCard", requirePayload, requireModule("cards", "delete"), c.deleteCard);

module.exports = router;
