// src/routes/kanbanRoutes.js
const express = require("express");
const kanbanController = require("../controllers/kanbanController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule } = require("../middleware/permission");

const router = express.Router();

// Governed by the tasks module (view); workspace membership decides the rest.
router.use(verifyToken, loadScope);

router.post("/saveKanbanColumn", requireModule("tasks", "view"), kanbanController.save);
router.post("/fetchKanbanColumns", requireModule("tasks", "view"), kanbanController.fetch);
router.post("/deleteKanbanColumn", requireModule("tasks", "view"), kanbanController.delete);

module.exports = router;
