// src/routes/callingRoutes.js — calling lists (149).
// Managers: the plain `calling` grant. Callers: no grant of their own — anyone who
// can add leads may be given contacts, and sees only what they hold (in SQL).
const express = require("express");
const c = require("../controllers/callingController");
const k = require("../controllers/callingCallerController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, saveAction, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();
router.use(verifyToken, loadScope);

router.post("/fetchLists", allowEmptyPayload, requireModule("calling", "view"), c.fetchLists);
router.post("/saveList", requirePayload, requireModule("calling", saveAction), c.saveList);
router.post("/deleteList", requirePayload, requireAdmin, c.deleteList); // Owner / Admin only (spec 3a)
router.post("/saveCallers", requirePayload, requireModule("calling", "edit"), c.saveCallers);
router.post("/importContacts", requirePayload, requireModule("calling", "add"), c.importContacts);
router.post("/addContact", requirePayload, requireModule("calling", "add"), c.addContact);
router.post("/fetchContacts", requirePayload, requireModule("calling", "edit"), c.fetchContacts);
router.post("/contactHistory", requirePayload, requireModule("calling", "edit"), c.contactHistory);
router.post("/assign", requirePayload, requireModule("calling", "edit"), c.assign);
router.post("/recall", requirePayload, requireModule("calling", "edit"), c.recall);
router.post("/setState", requirePayload, requireModule("calling", "edit"), c.setState);

router.post("/myList", allowEmptyPayload, requireModule("leads", "add"), k.myList);
router.post("/saveResult", requirePayload, requireModule("leads", "add"), k.saveResult);
router.post("/convert", requirePayload, requireModule("leads", "add"), k.convert);
router.post("/undoResult", requirePayload, requireModule("leads", "add"), k.undoResult);

module.exports = router;
