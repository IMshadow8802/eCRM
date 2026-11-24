// src/services/callingService.js
//
// Calling lists (149): the callback cut-off on the caller's working calendar, and
// the shape of sp_FetchMyCallList's reply.
const calendarContext = require("./calendarContext");
const { addDays, dateKey, workIntervals, at } = require("../utils/workCalendar");

const SEARCH_DAYS = 14;

// The end of the last working interval on the first working day after the callback's IST day.
function callbackReleaseAt(callbackAt, ctx) {
  const day = dateKey(callbackAt);
  for (let i = 1; i <= SEARCH_DAYS; i++) {
    const iv = workIntervals(addDays(day, i), ctx);
    if (iv.length) return iv[iv.length - 1][1];
  }
  return at(addDays(day, 2), 23 * 60 + 59);
}

// null on any failure: the procedure then uses its own fallback.
async function releaseAtFor(compId, userId, callbackAt) {
  try {
    const day = dateKey(callbackAt);
    const info = (await calendarContext.load(compId, [userId], day, addDays(day, SEARCH_DAYS + 1))).get(userId);
    return info ? callbackReleaseAt(callbackAt, info.ctx) : null;
  } catch (err) {
    console.error("CALLBACK_RELEASE_ERROR:", err.message);
    return null;
  }
}

function extrasOf(json) {
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o).map(([label, value]) => ({ label, value: String(value) }))
      : [];
  } catch {
    return [];
  }
}
const withExtras = (rows = []) => rows.map(({ Extra, ...r }) => ({ ...r, extras: Extra ? extrasOf(Extra) : [] }));

function shapeMyList(result) {
  const [head = [], toCall, callbacks, done = [], lists = []] = result?.recordsets ?? [];
  return { head: head[0] ?? {}, toCall: withExtras(toCall), callbacks: withExtras(callbacks), done, lists };
}

// RS2 of a paged calling fetch → the web table's pagination block.
function pagination(result, PageNumber, PageSize, count) {
  const p = result?.recordsets?.[1]?.[0] ?? {};
  return { currentPage: p.CurrentPage ?? PageNumber, pageSize: p.PageSize ?? PageSize,
    totalRecords: p.TotalRecords ?? count, totalPages: p.TotalPages ?? (count ? 1 : 0) };
}

module.exports = { callbackReleaseAt, releaseAtFor, shapeMyList, pagination, withExtras };
