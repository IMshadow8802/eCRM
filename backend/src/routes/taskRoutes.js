// src/routes/taskRoutes.js
const express = require("express");
const taskController = require("../controllers/taskController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");

const router = express.Router();

router.use(verifyToken, loadScope);

// Main task operations
router.post("/saveTask", taskController.save);
router.post("/fetchTasks", taskController.fetch);
router.post("/deleteTask", taskController.delete);
router.post("/bulkDeleteTasks", taskController.bulkDelete);

// Task comments
router.post("/addTaskComment", taskController.addComment);
router.post("/getTaskComments", taskController.getComments);
router.post("/deleteTaskComment", taskController.deleteComment);
router.post("/pinTaskComment", taskController.pinComment);
router.post("/markTaskCommentRead", taskController.markCommentRead);

// Task dependencies
router.post("/addTaskDependency", taskController.addDependency);
router.post("/removeTaskDependency", taskController.removeDependency);
router.post("/fetchTaskDependencies", taskController.fetchDependencies);

// Time tracking
router.post("/logTaskTime", taskController.logTime);
router.post("/getTaskTimeEntries", taskController.getTimeEntries);
router.post("/deleteTaskTimeEntry", taskController.deleteTimeEntry);

// Checklist
router.post("/saveTaskChecklist", taskController.saveChecklist);
router.post("/getTaskChecklist", taskController.getChecklist);
router.post("/deleteTaskChecklist", taskController.deleteChecklist);

// Activity
router.post("/getTaskActivity", taskController.getActivity);

module.exports = router;
