// src/routes/taskRoutes.js
const express = require("express");
const taskController = require("../controllers/taskController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule } = require("../middleware/permission");

const router = express.Router();

// Governed by the tasks module (view); workspace membership decides the rest.
router.use(verifyToken, loadScope);

// Main task operations
router.post("/saveTask", requireModule("tasks", "view"), taskController.save);
// Column moves are change_status, not edit_fields — see sp_MoveTaskColumn (064).
router.post("/moveTaskColumn", requireModule("tasks", "view"), taskController.moveColumn);
// "Take this task" — claim_task, unassigned tasks only (094).
router.post("/claimTask", requireModule("tasks", "view"), taskController.claim);
router.post("/fetchTasks", requireModule("tasks", "view"), taskController.fetch);
router.post("/deleteTask", requireModule("tasks", "view"), taskController.delete);
router.post("/bulkDeleteTasks", requireModule("tasks", "view"), taskController.bulkDelete);

// Task comments
router.post("/addTaskComment", requireModule("tasks", "view"), taskController.addComment);
router.post("/getTaskComments", requireModule("tasks", "view"), taskController.getComments);
router.post("/deleteTaskComment", requireModule("tasks", "view"), taskController.deleteComment);
router.post("/pinTaskComment", requireModule("tasks", "view"), taskController.pinComment);
router.post("/markTaskCommentRead", requireModule("tasks", "view"), taskController.markCommentRead);

// Task dependencies
router.post("/addTaskDependency", requireModule("tasks", "view"), taskController.addDependency);
router.post("/removeTaskDependency", requireModule("tasks", "view"), taskController.removeDependency);
router.post("/fetchTaskDependencies", requireModule("tasks", "view"), taskController.fetchDependencies);

// Time tracking
router.post("/logTaskTime", requireModule("tasks", "view"), taskController.logTime);
router.post("/getTaskTimeEntries", requireModule("tasks", "view"), taskController.getTimeEntries);
router.post("/deleteTaskTimeEntry", requireModule("tasks", "view"), taskController.deleteTimeEntry);

// Checklist
router.post("/saveTaskChecklist", requireModule("tasks", "view"), taskController.saveChecklist);
router.post("/getTaskChecklist", requireModule("tasks", "view"), taskController.getChecklist);
router.post("/deleteTaskChecklist", requireModule("tasks", "view"), taskController.deleteChecklist);

// Activity
router.post("/getTaskActivity", requireModule("tasks", "view"), taskController.getActivity);

module.exports = router;
