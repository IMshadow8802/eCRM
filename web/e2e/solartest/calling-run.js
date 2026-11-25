// e2e/solartest/calling-run.js — shared by the calling-list runs on SolarTest
// (calling-api.spec.js, calling.spec.js, mobile/.maestro/solartest/calling-setup.mjs).
// Talks only to localhost:5001. The password comes from backend/.env.live and is
// never printed. proveSolarTest() runs before any write.
//
// Every list a run makes is named "CALLTEST b<block> ...": the block is the run's
// number range (calling-fixtures.mjs), read back from the list names so no state
// file is needed. leftovers() pulls every CALLTEST list's contacts back and
// archives it; openHours() widens SolarTest's calling hours for a night run and
// restoreHours() puts the saved values back.
import fs from "node:fs";
import path from "node:path";
import { livePassword } from "../personas.js";

export const API = "http://localhost:5001";

// key -> exact username (trailing spaces matter) and id on SolarTest.
export const PEOPLE = {
  amit: { u: "Amit", id: 2, kind: "owner" },
  neha: { u: "Neha ", id: 34, kind: "manager" },
  deeksha: { u: "Deeksha", id: 27, kind: "sales" },
  roshan: { u: "Roshan", id: 28, kind: "sales" },
  kasak: { u: "Kasak ", id: 29, kind: "sales" },
  sarika: { u: "Sarika ", id: 30, kind: "sales" },
  tanu: { u: "Tanu ", id: 31, kind: "sales" },
  ashish: { u: "Ashish ", id: 32, kind: "sales" },
  pawan: { u: "Pawan ", id: 33, kind: "sales" },
  nitin: { u: "Nitin ", id: 35, kind: "support" },
  prasant: { u: "Prasant ", id: 36, kind: "support" },
  rohit: { u: "Rohit ", id: 37, kind: "support" },
  vinod: { u: "Vinod ", id: 38, kind: "support" },
  vivek: { u: "Vivek", id: 39, kind: "support" },
};

const tokens = {};
async function login(who) {
  const r = await fetch(`${API}/api/auth/loginUser`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: PEOPLE[who].u, password: livePassword() }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200 || !j?.data?.token) throw new Error(`sign-in failed for ${who}: ${r.status} ${j?.message ?? ""}`);
  return (tokens[who] = j.data.token);
}

/** POST as a person → { status, body, raw } (raw = the reply text, for leak scans). */
export async function post(who, route, body = {}) {
  for (let i = 0; i < 2; i += 1) {
    const t = tokens[who] ?? (await login(who));
    let r;
    for (let tries = 0; ; tries += 1) {   // nodemon restarts the backend on a file save: wait it out
      try {
        r = await fetch(API + route, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
        });
        break;
      } catch (e) {
        if (tries > 20) throw e;
        await new Promise((ok) => setTimeout(ok, 1000));
      }
    }
    const raw = await r.text();
    let json = {};
    try { json = JSON.parse(raw); } catch { /* not json */ }
    if (r.status === 401 && i === 0) { delete tokens[who]; continue; }
    return { status: r.status, body: json, raw };
  }
  return null;
}

/** The reply's data, or a throw naming the call (set-up steps only). */
export async function must(who, route, body, ok = [200, 201]) {
  const r = await post(who, route, body);
  if (!ok.includes(r.status)) throw new Error(`${who} ${route} answered ${r.status}: ${r.body?.message ?? r.raw.slice(0, 200)}`);
  return r.body?.data;
}

export async function proveSolarTest() {
  const h = await fetch(`${API}/health`).catch(() => null);
  if (h?.status !== 200) throw new Error(`refused: ${API}/health is not 200`);
  await login("neha").catch(() => { throw new Error("refused: 'Neha ' cannot sign in with LIVE_PASSWORD - this is not SolarTest"); });
}

// ---- lists --------------------------------------------------------------------

export async function callTestLists() {
  const out = [];
  for (const Status of ["active", "paused", "archived"]) {
    const d = await must("amit", "/api/calling/fetchLists", { Status, SearchTerm: "CALLTEST", PageSize: 500 });
    out.push(...(d.lists ?? []));
  }
  return out;
}

/** The next unused number block (1..999): one past the highest "CALLTEST b<n>" list. */
export async function nextBlock() {
  const used = (await callTestLists()).map((l) => Number(/CALLTEST b(\d+)/.exec(l.Name)?.[1] ?? 0));
  const n = Math.max(0, ...used) + 1;
  if (n > 999) throw new Error("all 999 number blocks are used");
  return n;
}

const listBody = (l, over = {}) => ({
  Id: l.Id, BranchId: l.BranchId, Name: l.Name, Vendor: l.Vendor, PurchasedOn: l.PurchasedOn ? String(l.PurchasedOn).slice(0, 10) : null,
  Cost: l.Cost, ProductId: l.ProductId, Script: l.Script, AutoTopUp: l.AutoTopUp, HoldSize: l.HoldSize,
  MaxAttempts: l.MaxAttempts, RetryGapHours: l.RetryGapHours, Status: l.Status, ...over,
});

/** Pull back every CALLTEST list's held contacts and callbacks, then archive the list. */
export async function leftovers() {
  for (const l of await callTestLists()) {
    if (l.Status === "archived") continue;
    await must("amit", "/api/calling/recall", { CallListId: l.Id, IncludeCallbacks: true });
    await must("amit", "/api/calling/saveList", listBody(l, { Status: "archived" }));
  }
}

export async function createList(name, over = {}) {
  const d = await must("amit", "/api/calling/saveList", {
    Id: 0, BranchId: 1, Name: name, Vendor: "Fake Data Co (test)", PurchasedOn: today(), Cost: 4321,
    AutoTopUp: 1, HoldSize: 5, MaxAttempts: 3, RetryGapHours: 4, Script: "Namaste, solar rooftop ke baare mein baat karni thi.", ...over,
  });
  return d.Id;
}

export async function setList(id, over) {
  const d = await must("amit", "/api/calling/fetchLists", { Id: id });
  return must("amit", "/api/calling/saveList", listBody(d.list, over));
}

// ---- calling hours (a night run needs them open) ---------------------------------

const SAVED = path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".auth", "calling-settings.json");
const SETTING_KEYS = ["LateGraceMin", "SessionBufferMin", "WarnPct", "NotifyNotSignedIn", "GoLiveDate", "CommissionDueOn",
  "CallStartMin", "CallEndMin", "CallbackCap"];

async function settings() {
  const s = (await must("amit", "/api/work/fetchWorkSettings", {})).settings;
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]]));
}

/** Calling hours 00:00–24:00 and the given callback cap; the original values are saved once. */
export async function openHours(CallbackCap) {
  const now = await settings();
  if (!fs.existsSync(SAVED)) {
    fs.mkdirSync(path.dirname(SAVED), { recursive: true });
    fs.writeFileSync(SAVED, JSON.stringify(now));
  }
  const orig = JSON.parse(fs.readFileSync(SAVED, "utf8"));
  await must("amit", "/api/work/saveCompanySetting", { ...now, CallStartMin: 0, CallEndMin: 1440, CallbackCap: CallbackCap ?? orig.CallbackCap });
}

export async function restoreHours() {
  if (!fs.existsSync(SAVED)) return;
  const orig = JSON.parse(fs.readFileSync(SAVED, "utf8"));
  await must("amit", "/api/work/saveCompanySetting", orig);
  fs.rmSync(SAVED);
}

// ---- small things -----------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");
/** Local calendar day, never toISOString (UTC rolls IST mornings back). */
export function today(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Results of one run's checks, appended to $CALLING_RESULTS (JSON lines) when set. */
export function recorder(suite) {
  const rows = [];
  return {
    rows,
    add(name, pass, detail = "") { rows.push({ suite, name, pass: !!pass, detail: String(detail).slice(0, 500) }); return !!pass; },
    flush() {
      if (process.env.CALLING_RESULTS) fs.appendFileSync(process.env.CALLING_RESULTS, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    },
  };
}
