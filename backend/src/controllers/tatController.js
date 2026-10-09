// src/controllers/tatController.js
//
// Task TAT (spec §6): the company policy, a task's clocks, the assignee and
// manager actions on them, and the Today panels (mine / my team). Every
// task-bound action first needs view_task on that task (404 otherwise), so a
// guessed TaskId learns nothing.

const database = require("../config/database");
const calendarContext = require("../services/calendarContext");
const tatService = require("../services/tatService");
const { taskAllowed } = require("../middleware/permission");
const { visibleUserIds } = require("./workSettingsController");
const { withStatus } = require("./presenceController");
const { emitToUser } = require("../realtime/events");
const { SCOPES } = require("../realtime/contract");
const { DEFAULT_DAYS, addWorkingMinutes, dateKey, addDays, at } = require("../utils/workCalendar");
const { success, error, validationError } = require("../utils/responseHelper");
const { asyncRoute, firstRow, spStatus, spOk, spMessage, positiveInt } = require("../utils/controllerKit");

const rows = (result, i = 0) => result?.recordsets?.[i] ?? [];
const SELF_HOLD_MIN = 1440; // 3 standard working days (8 h)
// Spec §6: a workspace owner OR manager may judge. The live sp_CheckTaskPermission
// grants exactly that role pair to pin_comment (manage_members is owner-only).
const JUDGE_ACTION = "pin_comment";
const truthy = (v) => v === true || v === 1 || v === "true";
const MAX_TEAM = 1000;
const KEY = /^\d{4}-\d{2}-\d{2}$/; // ponytail: one page of sp_FetchUser; page it if a company outgrows it

const reply = (res, row, data = null) => {
  const ok = spOk(row);
  return res.status(spStatus(row)).json({
    success: ok, message: spMessage(row), responseCode: spStatus(row),
    data: ok ? data : null, timestamp: new Date().toISOString(),
  });
};
const notFound = (res) => error(res, "Task not found", "NOT_FOUND", 404);
const forbidden = (res, msg) => error(res, msg, "FORBIDDEN", 403);

// The TaskId of the body, gated by view_task. Answers the 400/404 itself and returns null.
async function viewableTask(req, res) {
  const taskId = positiveInt(req.body.TaskId);
  if (!taskId) { validationError(res, "TaskId is required"); return null; }
  if (!(await taskAllowed(req, taskId, "view_task"))) { notFound(res); return null; }
  return taskId;
}

// sp_FetchPresence rows for a day, each with presenceStatus — the same rule as
// presenceController.fetchPresence: shift start from the calendar when no row
// exists yet, and only today can be Online (an open session is about now).
async function presenceFor(CompId, ids, key, now) {
  const [pres, info, settings] = await Promise.all([
    database.executeStoredProcedure("sp_FetchPresence", { CompId, WorkDate: at(key, 0), UserIdsJson: JSON.stringify(ids) }),
    calendarContext.load(CompId, ids, key, key),
    calendarContext.settings(CompId),
  ]);
  return rows(pres).map((r) => withStatus(r, info.get(Number(r.UserId)), key, now, settings));
}

class TatController {
  fetchTatPolicy = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure("sp_FetchTatPolicy", { CompId: req.user.CompId });
      return success(res, "Time allowed per priority fetched", { policy: rows(result) });
    },
    "Failed to fetch the time allowed per priority",
    "TAT_POLICY_FETCH_ERROR",
  );

  saveTatPolicy = asyncRoute(
    async (req, res) => {
      const { Items } = req.body;
      if (!Array.isArray(Items) || !Items.length) return validationError(res, "Items are required");
      const CompId = req.user.CompId;
      const result = await database.executeStoredProcedure("sp_SaveTatPolicy", {
        CompId, ItemsJson: JSON.stringify(Items.map((i) => ({ Priority: i?.Priority, Minutes: i?.Minutes }))),
      });
      const row = firstRow(result);
      if (spOk(row)) {
        try {
          await database.executeStoredProcedure("sp_TatMarkStale", { CompId, TaskId: null, UserId: null, Kind: "change" });
        } catch (err) { console.error("sp_TatMarkStale skipped:", err.message); }
      }
      return reply(res, row);
    },
    "Failed to save the time allowed per priority",
    "TAT_POLICY_SAVE_ERROR",
  );

  fetchTaskTat = asyncRoute(
    async (req, res) => {
      const taskId = await viewableTask(req, res);
      if (!taskId) return undefined;
      const me = Number(req.user.UserId);
      const result = await database.executeStoredProcedure("sp_FetchTaskTat", { CompId: req.user.CompId, TaskId: taskId });
      const clocks = rows(result, 0);
      const others = [...new Set(clocks.map((c) => Number(c.UserId)).filter((id) => id !== me))];
      const wide = others.length > 0 && (req.scope?.isAdmin || (await taskAllowed(req, taskId, JUDGE_ACTION)));
      // Ancestors of each clock's person: the same chain sp_TatSaveVerdict accepts.
      const judged = new Set();
      if (!wide) {
        for (const id of others) {
          const chain = rows(await database.executeStoredProcedure("sp_FetchEscalationTargets", { CompId: req.user.CompId, UserId: id }));
          if (chain.some((u) => Number(u.Id) === me)) judged.add(id);
        }
      }
      return success(res, "Task deadline fetched", {
        clocks: clocks.map((c) => {
          const uid = Number(c.UserId);
          return { ...c, CanJudge: uid !== me && (wide || judged.has(uid)) };
        }),
        holds: rows(result, 1),
        events: rows(result, 2),
      });
    },
    "Failed to fetch task TAT",
    "TAT_FETCH_ERROR",
  );

  acknowledge = asyncRoute(
    async (req, res) => {
      const taskId = await viewableTask(req, res);
      if (!taskId) return undefined;
      const result = await database.executeStoredProcedure("sp_TatAcknowledge", {
        CompId: req.user.CompId, TaskId: taskId, UserId: req.user.UserId,
      });
      const row = firstRow(result);
      return reply(res, row, { acknowledged: row?.Acknowledged === true || row?.Acknowledged === 1 });
    },
    "Failed to accept the task",
    "TAT_ACK_ERROR",
  );

  hold = asyncRoute(
    async (req, res) => {
      const taskId = await viewableTask(req, res);
      if (!taskId) return undefined;
      const { Remarks = null } = req.body;
      const Mine = truthy(req.body.Mine);
      const reasonId = positiveInt(req.body.ReasonId);
      if (!reasonId) return validationError(res, "Pick a reason for the hold");
      const CompId = req.user.CompId;
      const me = Number(req.user.UserId);
      let autoRelease = null;
      if (Mine) {
        // A self-hold releases itself after 3 working days of the person's own calendar.
        const now = new Date();
        const info = (await calendarContext.load(CompId, [me], dateKey(now), addDays(dateKey(now), 30))).get(me);
        autoRelease = addWorkingMinutes(now, SELF_HOLD_MIN, info?.ctx ?? { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() });
      } else if (!(await taskAllowed(req, taskId, "reassign"))) {
        return forbidden(res, "Only the creator or a workspace owner/manager can hold everyone's timer");
      }
      const result = await database.executeStoredProcedure("sp_TatHold", {
        CompId, TaskId: taskId, UserId: Mine ? me : null, ReasonId: reasonId, Remarks,
        ActorUserId: me, AutoReleaseAt: autoRelease,
      });
      const row = firstRow(result);
      if (spOk(row)) for (const n of rows(result, 1)) emitToUser(n.UserId, SCOPES.NOTIFICATIONS);
      return reply(res, row, { held: row?.Held ?? 0 });
    },
    "Failed to put the task on hold",
    "TAT_HOLD_ERROR",
  );

  release = asyncRoute(
    async (req, res) => {
      const taskId = await viewableTask(req, res);
      if (!taskId) return undefined;
      // Mirrors hold. Mine → your own clock only; without reassign, only a manual
      // hold you started yourself (one open hold per clock). Not Mine → everyone's
      // clocks, which needs reassign.
      const me = Number(req.user.UserId);
      const mine = truthy(req.body.Mine);
      const all = await taskAllowed(req, taskId, "reassign");
      if (!mine && !all) return forbidden(res, "Only the creator or a workspace owner/manager can release everyone's hold");
      if (mine && !all) {
        const holds = rows(await database.executeStoredProcedure("sp_FetchTaskTat", { CompId: req.user.CompId, TaskId: taskId }), 1);
        const own = holds.some((h) => Number(h.UserId) === me && h.Kind === "manual" && !h.EndedAt && Number(h.StartedBy) === me);
        if (!own) return forbidden(res, "Only the creator or a workspace owner/manager can release this hold");
      }
      const result = await database.executeStoredProcedure("sp_TatRelease", {
        CompId: req.user.CompId, TaskId: taskId, UserId: mine ? me : null, ActorUserId: req.user.UserId,
      });
      const row = firstRow(result);
      if (spOk(row)) await tatService.afterTaskWrite(req, taskId); // apply the held minutes now
      return reply(res, row, { released: row?.Released ?? 0 });
    },
    "Failed to release the hold",
    "TAT_RELEASE_ERROR",
  );

  myPartDone = asyncRoute(
    async (req, res) => {
      const taskId = await viewableTask(req, res);
      if (!taskId) return undefined;
      const result = await database.executeStoredProcedure("sp_TatMyPartDone", {
        CompId: req.user.CompId, TaskId: taskId, UserId: req.user.UserId,
      });
      return reply(res, firstRow(result));
    },
    "Failed to close your part",
    "TAT_PART_DONE_ERROR",
  );

  // Own clock only — the SP checks it. No task gate: a reason is owed even after
  // the person has lost access to the task.
  saveReason = asyncRoute(
    async (req, res) => {
      const tatId = positiveInt(req.body.TatId);
      const reasonId = positiveInt(req.body.ReasonId);
      if (!tatId) return validationError(res, "TatId is required");
      if (!reasonId) return validationError(res, "Pick a reason");
      const result = await database.executeStoredProcedure("sp_TatSaveReason", {
        CompId: req.user.CompId, TatId: tatId, UserId: req.user.UserId, ReasonId: reasonId, Remarks: req.body.Remarks ?? null,
      });
      return reply(res, firstRow(result));
    },
    "Failed to save the reason",
    "TAT_REASON_ERROR",
  );

  saveVerdict = asyncRoute(
    async (req, res) => {
      const taskId = await viewableTask(req, res);
      if (!taskId) return undefined;
      const tatId = positiveInt(req.body.TatId);
      if (!tatId) return validationError(res, "TatId is required");
      const CompId = req.user.CompId;
      // ActorManagesWorkspace speaks for THIS task, so the clock must be one of its clocks.
      const clocks = rows(await database.executeStoredProcedure("sp_FetchTaskTat", { CompId, TaskId: taskId }));
      if (!clocks.some((c) => Number(c.Id) === tatId)) return error(res, "Deadline timer not found", "NOT_FOUND", 404);
      const manages = await taskAllowed(req, taskId, JUDGE_ACTION);
      const result = await database.executeStoredProcedure("sp_TatSaveVerdict", {
        CompId, TatId: tatId, ActorUserId: req.user.UserId, Verdict: req.body.Verdict ?? null,
        Remarks: req.body.Remarks ?? null, ActorManagesWorkspace: manages ? 1 : 0,
      });
      return reply(res, firstRow(result));
    },
    "Failed to save the decision",
    "TAT_VERDICT_ERROR",
  );

  // The caller's own day. presence carries the same grace-aware status their manager sees.
  fetchToday = asyncRoute(
    async (req, res) => {
      const { CompId, UserId } = req.user;
      const now = new Date();
      const [result, presence] = await Promise.all([
        database.executeStoredProcedure("sp_FetchToday", { CompId, UserId }),
        presenceFor(CompId, [Number(UserId)], dateKey(now), now),
      ]);
      const mine = presence[0];
      return success(res, "Today fetched", {
        presence: mine ? { ...(rows(result, 0)[0] ?? {}), ...mine } : null,
        clocks: rows(result, 1),
        reasonPending: rows(result, 2),
      });
    },
    "Failed to fetch today",
    "TODAY_FETCH_ERROR",
  );

  // Everyone the caller may see (attendance reach), not themselves. WorkDate defaults to today (IST).
  fetchTeamToday = asyncRoute(
    async (req, res) => {
      const now = new Date();
      const key = req.body.WorkDate ? String(req.body.WorkDate).slice(0, 10) : dateKey(now);
      if (!KEY.test(key)) return validationError(res, "Date must be YYYY-MM-DD");
      const CompId = req.user.CompId;
      const me = Number(req.user.UserId);
      const users = rows(await database.executeStoredProcedure("sp_FetchUser", {
        Id: 0, CompId, BranchId: req.user.BranchId, IsAdmin: 1, AccessibleBranchIdsJson: null,
        PageNumber: 1, PageSize: MAX_TEAM, SearchTerm: null,
      }));
      const company = [...new Set(users.map((u) => Number(u.Id)).filter((id) => id && id !== me))];
      const allowed = await visibleUserIds(req, company);
      const ids = allowed === null ? company : company.filter((id) => allowed.includes(id));
      if (!ids.length) return success(res, "Team today fetched", { team: [] });

      const [presence, counts] = await Promise.all([
        presenceFor(CompId, ids, key, now),
        database.executeStoredProcedure("sp_FetchTeamToday", { CompId, WorkDate: at(key, 0), UserIdsJson: JSON.stringify(ids) }),
      ]);
      const byUser = new Map(rows(counts).map((c) => [Number(c.UserId), c]));
      const team = presence.map((r) => {
        const c = byUser.get(Number(r.UserId)) ?? {};
        return { ...r, Open: c.Open ?? 0, AtRisk: c.AtRisk ?? 0, Over: c.Over ?? 0, ReasonPending: c.ReasonPending ?? 0 };
      });
      return success(res, "Team today fetched", { team });
    },
    "Failed to fetch the team",
    "TEAM_TODAY_FETCH_ERROR",
  );
}

module.exports = new TatController();
