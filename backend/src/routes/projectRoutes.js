// src/routes/projectRoutes.js
const express = require("express");
const projectController = require("../controllers/projectController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveProject", projectController.save);
router.post("/fetchProjects", projectController.fetch);

module.exports = router;
