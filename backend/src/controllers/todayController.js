// src/controllers/todayController.js
//
// Today (spec §2.1–2.2): Mine, My team, the team-tab count and the drawer behind
// every number. Scope = the attendance reach (teamIds); personal tasks only ever
// for the caller's own data.

const { loadDay, teamIds } = require("../services/todayData");
const { BUCKETS, rankPeople } = require("../utils/dayBuckets");
const { dateKey } = require("../utils/workCalendar");
const { success, error, validationError } = require("../utils/responseHelper");
const { asyncRoute, positiveInt } = require("../utils/controllerKit");

const KEY = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar day: the format, and it survives a UTC round-trip (2026-02-30 does not).
const isDay = (k) => {
  const d = new Date(`${k}T00:00:00Z`);
  return KEY.test(k) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === k;
};
const CODE = "TODAY_FETCH_ERROR";

// The picked day, or null after answering 400.
function dayOf(req, res, now) {
  const today = dateKey(now);
  const key = req.body?.WorkDate ? String(req.body.WorkDate).slice(0, 10) : today;
  if (!isDay(key)) { validationError(res, "Date must be YYYY-MM-DD"); return null; }
  if (key > today) { validationError(res, "Pick today or an earlier day"); return null; }
  return key;
}

const dayFor = (req, ids, key, now, includePersonal) => loadDay({
  CompId: req.user.CompId, ids, key, now, viewerId: req.user.UserId,
  viewerIsAdmin: Boolean(req.scope?.isAdmin), includePersonal,
});

class TodayController {
  mine = asyncRoute(async (req, res) => {
    const now = new Date();
    const key = dayOf(req, res, now);
    if (!key) return undefined;
    const { live, people } = await dayFor(req, [Number(req.user.UserId)], key, now, true);
    return success(res, "Your day fetched", { day: { key, live }, me: people[0] ?? null });
  }, "Failed to fetch your day", CODE);

  team = asyncRoute(async (req, res) => {
    const now = new Date();
    const key = dayOf(req, res, now);
    if (!key) return undefined;
    const me = Number(req.user.UserId);
    const { live, people } = await dayFor(req, [me, ...(await teamIds(req))], key, now, false);
    const lean = people.map(({ tasks, ...p }) => ({ ...p, isMe: Number(p.UserId) === me }));
    return success(res, "Team day fetched", {
      day: { key, live },
      people: [...lean.filter((p) => p.isMe), ...rankPeople(lean.filter((p) => !p.isMe))],
    });
  }, "Failed to fetch the team", CODE);

  teamSize = asyncRoute(async (req, res) => (
    success(res, "Team size fetched", { count: (await teamIds(req)).length })
  ), "Failed to fetch the team size", CODE);

  personTasks = asyncRoute(async (req, res) => {
    const now = new Date();
    const { Bucket } = req.body;
    if (!BUCKETS.includes(Bucket)) return validationError(res, "Unknown bucket");
    const userId = positiveInt(req.body.UserId);
    if (!userId) return validationError(res, "UserId is required");
    const key = dayOf(req, res, now);
    if (!key) return undefined;
    const self = userId === Number(req.user.UserId);
    if (!self && !(await teamIds(req)).includes(userId)) return error(res, "Not in your team", "FORBIDDEN", 403);
    // never personal: the drawer opens from a TeamDay card, which counts without personal
    const { people } = await dayFor(req, [userId], key, now, false);
    return success(res, "Tasks fetched", { tasks: (people[0]?.tasks ?? []).filter((t) => t.flags[Bucket]) });
  }, "Failed to fetch the tasks", CODE);
}

module.exports = new TodayController();
