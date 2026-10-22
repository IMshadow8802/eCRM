// src/routes/cardPhotoRoutes.js — /uploads/cards/:id/:file, card photos behind sign-in and the cards reach.
const express = require("express");
const c = require("../controllers/cardController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule } = require("../middleware/permission");

const router = express.Router();
router.get("/:id/:file", verifyToken, loadScope, requireModule("cards", "view"), c.cardPhoto);

module.exports = router;
