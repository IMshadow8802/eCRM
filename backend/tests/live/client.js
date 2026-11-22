// tests/live/client.js
//
// HTTP client for the live leak suite (plan 2026-11-22 Task 28, owner rulings
// L2 / B3 / T28-pw). It signs in as the seeded personas (am_<name>) and posts
// to a REAL backend, so two guards come before anything else:
//
//   1. The base URL. Only a local backend (localhost / 127.0.0.1, the owner
//      runs it against the TestCRM database) or a hosted one whose path ends
//      in /TestCRM. Anything else throws before a single request is made.
//   2. The database. Signing in as am_amit and resolving every AM- seed tag
//      works only where 136 ran, and 136 refuses any database but TestCRM.
//      A local backend pointed at eCRM+ fails here (am_amit does not exist).
//
// The password is the owner's TestCRM password (the personas copy its hash).
// It is read from the environment (backend/.env.live, loaded by
// tests/live/env.js) and is never printed: error messages carry the persona
// and the server's message, never the request body.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const SESSION_CODES = new Set(["SESSION_ENDED", "SESSION_EXPIRED", "SESSION_FORCED", "SESSION_REQUIRED"]);

/** The normalised base URL, or a throw saying why it is refused. No I/O. */
function checkBaseUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    throw new Error("Live suite refused: LIVE_BASE_URL is missing or not a URL. Set it in backend/.env.live.");
  }
  const path = u.pathname.replace(/\/+$/, "");
  const local = LOCAL_HOSTS.has(u.hostname) && (u.protocol === "http:" || u.protocol === "https:");
  const hostedTest = u.protocol === "https:" && path.endsWith("/TestCRM");
  if (!local && !hostedTest) {
    throw new Error(
      `Live suite refused: ${u.origin}${path} is neither a local backend (localhost / 127.0.0.1) `
      + "nor a /TestCRM backend. It never runs against a live company.",
    );
  }
  return u.origin + path;
}

const TAGS = {
  complaints: Array.from({ length: 20 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`),
  leads: Array.from({ length: 9 }, (_, i) => `L${String(i + 1).padStart(2, "0")}`),
  customers: ["HO", "ND", "SE"],
  personas: ["amit", "neha", "nitin", "rohit", "vinod", "vivek", "prasant", "kasak", "roshan",
    "stl", "field", "imran", "vikram", "pooja", "ndmgr", "hr", "gone", "readonly"],
};

function makeClient({ baseUrl, password, fetch: fetchImpl = globalThis.fetch } = {}) {
  const base = checkBaseUrl(baseUrl); // throws first: no request before the URL passes
  if (!password) throw new Error("Live suite refused: LIVE_PASSWORD is not set in backend/.env.live.");
  const tokens = new Map();
  let idsPromise = null;

  async function send(path, init) {
    const res = await fetchImpl(base + path, init);
    const type = res.headers?.get?.("content-type") ?? "";
    const body = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body };
  }

  async function login(persona) {
    const r = await send("/api/auth/loginUser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `am_${persona}`, password }),
    });
    const token = r.body?.data?.token;
    if (r.status !== 200 || !token) {
      throw new Error(`am_${persona} could not sign in at ${base} (${r.status}: ${r.body?.message ?? "no message"})`);
    }
    tokens.set(persona, token);
    return token;
  }

  // One retry after a 401 session code: a deactivate / role change in the
  // flows ends that person's sessions, and the next call signs in again.
  async function authed(persona, makeInit, path) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = tokens.get(persona) ?? (await login(persona));
      const init = makeInit();
      init.headers = { ...(init.headers ?? {}), Authorization: `Bearer ${token}` };
      const r = await send(path, init);
      if (r.status === 401 && attempt === 0 && SESSION_CODES.has(r.body?.code)) {
        tokens.delete(persona);
        continue;
      }
      return r;
    }
    return null; // unreachable
  }

  function as(persona) {
    return {
      post: (path, body = {}) => authed(persona, () => ({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }), path),
      // Multipart. Entity before the file: multer reads it while parsing. A
      // PDF, because the upload whitelist refuses text/plain with a 400 that
      // would hide the access answer.
      upload: (path, fields) => authed(persona, () => {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
        form.append("file", new Blob(["%PDF-1.4\n% AM live suite\n%%EOF\n"], { type: "application/pdf" }), "am-live.pdf");
        return { method: "POST", body: form };
      }, path),
    };
  }

  function forget(persona) {
    tokens.delete(persona);
  }

  // Seed tags -> ids, through am_amit's own list calls. This is also the
  // database proof: a missing tag means this is not the seeded TestCRM.
  async function resolveIds() {
    const amit = as("amit");
    const list = async (path, body, key) => {
      const r = await amit.post(path, body);
      if (r.status !== 200) throw new Error(`${path} answered ${r.status}: ${r.body?.message}`);
      return r.body?.data?.[key] ?? [];
    };
    const out = { users: {}, people: {}, customers: {} };
    for (const t of await list("/api/tickets/fetchTickets", { SearchTerm: "AM-C", PageSize: 200 }, "tickets")) {
      const m = /^AM-(C\d\d) /.exec(t.Subject ?? "");
      if (m) out[m[1]] = t.Id;
    }
    for (const l of await list("/api/leads/fetchLeads", { SearchTerm: "AM-L", PageSize: 200 }, "leads")) {
      const m = /^AM-(L\d\d) /.exec(l.Name ?? "");
      if (m) out[m[1]] = l.Id;
    }
    for (const c of await list("/api/customers/fetchCustomers", { SearchTerm: "AM-Cust", PageSize: 50, IsActive: 1 }, "customers")) {
      const m = /^AM-Cust-(HO|ND|SE)$/.exec(c.Name ?? "");
      if (m) out.customers[m[1]] = c.Id;
    }
    for (const u of await list("/api/users/fetchUsers", { SearchTerm: "AM ", PageSize: 200 }, "users")) {
      const m = /^am_(\w+)$/.exec(u.Username ?? "");
      if (m && TAGS.personas.includes(m[1])) {
        out.users[m[1]] = u.Id;
        out.people[m[1]] = u;
      }
    }
    const missing = [
      ...TAGS.complaints.filter((t) => !out[t]).map((t) => `AM-${t}`),
      ...TAGS.leads.filter((t) => !out[t]).map((t) => `AM-${t}`),
      ...TAGS.customers.filter((t) => !out.customers[t]).map((t) => `AM-Cust-${t}`),
      ...TAGS.personas.filter((p) => !out.users[p]).map((p) => `am_${p}`),
    ];
    if (missing.length) {
      throw new Error(
        `Live suite refused: ${base} is not the seeded TestCRM database (missing ${missing.join(", ")}). `
        + "Apply 136 on TestCRM (137 first if it ran before), and point the backend at TestCRM.",
      );
    }
    return out;
  }

  /** Resolved once per client. Rejects (and so refuses the suite) off TestCRM. */
  function ids() {
    if (!idsPromise) {
      idsPromise = resolveIds().catch((err) => {
        idsPromise = null;
        if (/^Live suite refused/.test(err.message)) throw err;
        throw new Error(`Live suite refused: could not prove ${base} is TestCRM: ${err.message}`);
      });
    }
    return idsPromise;
  }

  return { base, as, ids, forget, login };
}

let shared = null;
/** The client for the live suites, from backend/.env.live. One per test file. */
function live() {
  if (!shared) shared = makeClient({ baseUrl: process.env.LIVE_BASE_URL, password: process.env.LIVE_PASSWORD });
  return shared;
}

// ---- shared by the live suites ---------------------------------------------

/** An id no table reaches: its 404 must be identical to an invisible record's. */
const MISSING_ID = 2147480000;

const pad = (n) => String(n).padStart(2, "0");
/** Local calendar day (never toISOString: UTC rolls IST mornings back). */
function day(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A refusal that hands back nothing: 403 or 404, success false, no data. */
function isRefusal(r) {
  return (r.status === 403 || r.status === 404) && r.body?.success === false && r.body?.data == null;
}

/** Lookup ids the suites need, read once as am_amit. */
async function lookups(c) {
  const amit = c.as("amit");
  const kind = async (Kind) => {
    const r = await amit.post("/api/config/fetchLookups", { Kind });
    if (r.status !== 200) throw new Error(`fetchLookups ${Kind} answered ${r.status}`);
    return r.body?.data?.lookups ?? [];
  };
  const [reasons, resolutions, ticketStatus, leadStatus] = await Promise.all(
    ["transfer_reason", "resolution", "ticket_status", "lead_status"].map(kind),
  );
  const code = (rows, c2) => rows.find((x) => x.Code === c2)?.Id;
  return {
    reasonId: reasons.find((x) => x.Code !== "sent_back")?.Id,
    resolutionId: resolutions[0]?.Id,
    ticketOpen: code(ticketStatus, "open"),
    ticketOnHold: code(ticketStatus, "onhold"),
    leadOpen: code(leadStatus, "open"),
    leadLost: code(leadStatus, "lost"),
  };
}

/** Highest notification id a persona has now; later notices have a larger one. */
async function noticeMark(c, persona) {
  const r = await c.as(persona).post("/api/notifications/fetchNotifications", { PageSize: 1 });
  return Number(r.body?.data?.notifications?.[0]?.Id ?? 0);
}

/** The persona's notices newer than `mark`, optionally of one Type. */
async function noticesSince(c, persona, mark, type) {
  const r = await c.as(persona).post("/api/notifications/fetchNotifications", { PageSize: 100 });
  return (r.body?.data?.notifications ?? []).filter((n) => Number(n.Id) > mark && (!type || n.Type === type));
}

/**
 * am_amit edits a persona through users/saveUser: the person's current row
 * (read fresh) with `changes` on top, so nothing else on it moves. Password is
 * never sent (blank = keep).
 */
async function saveUser(c, persona, changes) {
  const amit = c.as("amit");
  const ids = await c.ids();
  const found = await amit.post("/api/users/fetchUsers", { Id: ids.users[persona] });
  const p = found.body?.data?.users?.[0];
  if (!p?.Id) throw new Error(`fetchUsers did not return am_${persona}`);
  return amit.post("/api/users/saveUser", {
    Id: p.Id,
    Username: p.Username,
    FullName: p.FullName,
    Email: p.Email,
    JobTitle: p.JobTitle,
    HourlyRate: p.HourlyRate ?? 0,
    GroupId: p.GroupId,
    BranchId: p.BranchId,
    Mobile: p.Mobile,
    ReportsTo: p.ReportsTo,
    UserActive: Boolean(p.IsActive),
    ...changes,
  });
}

module.exports = {
  checkBaseUrl, makeClient, live, TAGS, MISSING_ID, day, isRefusal, lookups, noticeMark, noticesSince, saveUser,
};
