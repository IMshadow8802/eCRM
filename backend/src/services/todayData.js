// src/services/todayData.js
//
// Today (spec §1): one person-day = presence row + status, online time from the
// sessions, and their tasks through dayBuckets. Mine, My team and the drawer all
// read loadDay, so the numbers cannot disagree.

const database = require("../config/database");
const calendarContext = require("./calendarContext");
const { visibleUserIds } = require("../controllers/workSettingsController");
const { withStatus } = require("../controllers/presenceController");
const { describeTask, countTasks } = require("../utils/dayBuckets");
const { sessionDay, sessionsByUserDay } = require("../utils/sessionDay");
const { DEFAULT_DAYS, dateKey, at } = require("../utils/workCalendar");

const rows = (result, i = 0) => result?.recordsets?.[i] ?? [];
const MAX_TEAM = 1000; // ponytail: one page of sp_FetchUser; page it if a company outgrows it
const NOT_TRACKED = { code: "not_tracked", label: "Not tracked" };
const NO_CALENDAR = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };

// sp_FetchPresence rows for a day, each with presenceStatus — the same rule as
// presenceController.fetchPresence: shift start from the calendar when no row
// exists yet, and only today can be Online (an open session is about now).
// `info` (a calendarContext Map or a promise of one) skips the second load.
async function presenceFor(CompId, ids, key, now, info) {
  const [pres, cal, settings] = await Promise.all([
    database.executeStoredProcedure("sp_FetchPresence", { CompId, WorkDate: at(key, 0), UserIdsJson: JSON.stringify(ids) }),
    info ?? calendarContext.load(CompId, ids, key, key),
    calendarContext.settings(CompId),
  ]);
  return rows(pres).map((r) => withStatus(r, cal.get(Number(r.UserId)), key, now, settings));
}

// Everyone the caller may see (attendance reach), not themselves.
async function teamIds(req) {
  const me = Number(req.user.UserId);
  const users = rows(await database.executeStoredProcedure("sp_FetchUser", {
    Id: 0, CompId: req.user.CompId, BranchId: req.user.BranchId, IsAdmin: 1, AccessibleBranchIdsJson: null,
    PageNumber: 1, PageSize: MAX_TEAM, SearchTerm: null,
  }));
  const company = [...new Set(users.map((u) => Number(u.Id)).filter((id) => id && id !== me))];
  const allowed = await visibleUserIds(req, company);
  return allowed === null ? company : company.filter((id) => allowed.includes(id));
}

async function loadDay({ CompId, ids, key, now, viewerId, viewerIsAdmin = false, includePersonal = false }) {
  const live = key === dateKey(now);
  if (!ids.length) return { live, people: [] };
  const UserIdsJson = JSON.stringify(ids);
  const infoP = calendarContext.load(CompId, ids, key, key);
  const [tasks, sessions, presence, info] = await Promise.all([
    database.executeStoredProcedure("sp_FetchDayTasks", {
      CompId, WorkDate: at(key, 0), UserIdsJson, ViewerId: Number(viewerId),
      IncludePersonal: includePersonal ? 1 : 0, ViewerIsAdmin: viewerIsAdmin ? 1 : 0,
    }),
    database.executeStoredProcedure("sp_FetchSessionsRange", { CompId, FromDate: at(key, 0), ToDate: at(key, 0), UserIdsJson }),
    presenceFor(CompId, ids, key, now, infoP),
    infoP,
  ]);
  const online = sessionsByUserDay(rows(sessions), key, key, now);
  const byUser = Map.groupBy(rows(tasks), (t) => Number(t.UserId));
  const people = presence.map((p) => {
    const id = Number(p.UserId);
    const u = info.get(id);
    const ctx = u?.ctx ?? NO_CALENDAR;
    const described = (byUser.get(id) ?? []).map((t) => describeTask(t, { key, now, ctx, live }));
    const exempt = u?.presenceExempt || p.PresenceExempt === true || p.PresenceExempt === 1;
    return {
      ...p,
      // exempt still shows online now: Mine's pill reads status.online
      status: exempt ? { ...NOT_TRACKED, online: p.status?.code === "online" } : p.status,
      session: online.get(`${id}|${key}`) ?? sessionDay([], key, now),
      tasks: described,
      counts: countTasks(described, { live }),
    };
  });
  return { live, people };
}

module.exports = { presenceFor, teamIds, loadDay };
