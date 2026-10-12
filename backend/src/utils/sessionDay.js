// src/utils/sessionDay.js
//
// "Online today" (spec §1): sessions clipped to the day, overlaps merged, each
// session ending at EndedAt after a logout, else at its last heartbeat. Approximate by design
// (heartbeat every 2 min) — the UI calls it "online", never "worked".

const { at, addDays } = require("./workCalendar");

const t = (v) => (v == null ? null : new Date(v).getTime());

function sessionDay(sessions, key, now) {
  const start = at(key, 0).getTime();
  const dayEnd = at(addDays(key, 1), 0).getTime();
  const end = Math.min(dayEnd, now.getTime());
  const spans = [];
  const devices = new Set();
  let signIns = 0, last = null, open = false;
  for (const s of sessions) {
    const a = t(s.StartedAt);
    // A logout means the person was there to click sign out: EndedAt is real. Expired / forced
    // sessions end at the last heartbeat (EndedAt there can be hours after they left).
    const b = s.EndReason === "logout" && s.EndedAt
      ? t(s.EndedAt) : Math.min(t(s.EndedAt) ?? Infinity, t(s.LastSeenAt) ?? a);
    if (b < start || a >= dayEnd) continue;
    if (a >= start) signIns += 1;
    if (s.Device) devices.add(String(s.Device));
    const seen = t(s.LastSeenAt);
    // open / lastSeen are facts about *this* day: a heartbeat after midnight belongs to the next day.
    if (!s.EndedAt && seen != null && seen >= start && seen < dayEnd) open = true;
    if (seen != null && seen >= start) { const c = Math.min(seen, dayEnd); if (last == null || c > last) last = c; }
    const lo = Math.max(a, start), hi = Math.min(b, end);
    if (hi > lo) spans.push([lo, hi]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let ms = 0, curA = null, curB = null;
  for (const [a, b] of spans) {
    if (curB == null || a > curB) { if (curB != null) ms += curB - curA; curA = a; curB = b; }
    else curB = Math.max(curB, b);
  }
  if (curB != null) ms += curB - curA;
  return { onlineMinutes: Math.round(ms / 60000), signIns, devices: [...devices], lastSeenAt: last == null ? null : new Date(last), open };
}

function sessionsByUserDay(sessions, fromKey, toKey, now) {
  const byUser = new Map();
  for (const s of sessions) {
    const id = Number(s.UserId);
    if (!byUser.has(id)) byUser.set(id, []);
    byUser.get(id).push(s);
  }
  const out = new Map();
  for (const [id, list] of byUser) {
    for (let key = fromKey; key <= toKey; key = addDays(key, 1)) out.set(`${id}|${key}`, sessionDay(list, key, now));
  }
  return out;
}

module.exports = { sessionDay, sessionsByUserDay };
