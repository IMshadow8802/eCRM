// src/routes/kanbanRoutes.js
const express = require("express");
const kanbanController = require("../controllers/kanbanController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveKanbanColumn", kanbanController.save);
router.post("/fetchKanbanColumns", kanbanController.fetch);
router.post("/deleteKanbanColumn", kanbanController.delete);

module.exports = router;
