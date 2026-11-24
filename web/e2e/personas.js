// e2e/personas.js — shared bits of the access-model Playwright flows (plan
// 2026-11-22 Task 29, owner rulings L3 / T28-pw2).
//
// Target: the LOCAL web (http://localhost:8080/prdcrm/) talking to the LOCAL
// backend (http://localhost:5001) on the TestCRM database, or the hosted
// https://shadowcodes.in/TestCRM. Anything else is refused before a password
// is typed. Records are this run's own (global-setup.js -> run.json), never
// a hard-coded id and never the seeded AM-C / AM-L rows.
//
// The personas' test-only password lives in the git-ignored backend/.env.live
// (LIVE_PASSWORD). It is read here at run time, typed into the sign-in form by
// auth.setup.js only, and never printed or written anywhere.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

export const WEB_URL = "http://localhost:8080/prdcrm/";
export const COMPANY_CODE = "TestCRM";
// The eight personas the flows sign in as (am_<name>).
export const PERSONAS = ["nitin", "vinod", "vivek", "rohit", "neha", "kasak", "roshan", "amit"];

export const authFile = (persona) => path.join(here, ".auth", `${persona}.json`);

/** The web must be on localhost; the API base local :5001 or hosted /TestCRM. Throws otherwise. */
export function checkTarget(webUrl, apiBase) {
  const web = new URL(webUrl);
  if (!["localhost", "127.0.0.1"].includes(web.hostname)) {
    throw new Error(`E2E refused: the web is at ${web.origin}, not localhost.`);
  }
  let api;
  try { api = new URL(String(apiBase ?? "")); } catch { api = null; }
  const p = api ? api.pathname.replace(/\/+$/, "") : "";
  const local = api && ["localhost", "127.0.0.1"].includes(api.hostname) && api.port === "5001" && p === "";
  const hosted = api && api.protocol === "https:" && api.hostname === "shadowcodes.in" && api.port === "" && p === "/TestCRM";
  if (!local && !hosted) {
    throw new Error(`E2E refused: the API base is ${apiBase ?? "unset"}, neither http://localhost:5001 nor https://shadowcodes.in/TestCRM.`);
  }
  return api.origin + p;
}

/** LIVE_PASSWORD from backend/.env.live. The value is returned, never logged. */
export function livePassword() {
  const file = path.join(here, "..", "..", "backend", ".env.live");
  if (!fs.existsSync(file)) throw new Error("E2E refused: backend/.env.live is missing (the owner writes it).");
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("LIVE_PASSWORD="));
  const value = line?.slice("LIVE_PASSWORD=".length).trim().replace(/^(['"])(.*)\1$/, "$2");
  if (!value) throw new Error("E2E refused: LIVE_PASSWORD is not set in backend/.env.live.");
  return value;
}

/** The persisted auth store of a saved storage state: { token, API_BASE_URL, user }. */
function savedSession(persona) {
  const file = authFile(persona);
  if (!fs.existsSync(file)) throw new Error(`sign in again: PERSONA=${persona} pnpm e2e:auth`);
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  const item = state.origins?.flatMap((o) => o.localStorage ?? []).find((i) => i.name === "auth-storage-eCRM");
  const s = item ? JSON.parse(item.value)?.state : null;
  if (!s?.token) throw new Error(`sign in again: PERSONA=${persona} pnpm e2e:auth`);
  return s;
}

/**
 * Direct API calls as a persona, with its saved token — only for set-up the
 * screens do not offer (the "Away today" day mark, a quotation body) and for
 * resolving seed tags to ids. Every call re-checks the target.
 */
export function api(request, persona) {
  const s = savedSession(persona);
  const base = checkTarget(WEB_URL, s.API_BASE_URL);
  return async (route, body = {}) => {
    const r = await request.post(base + route, { data: body, headers: { Authorization: `Bearer ${s.token}` } });
    const json = await r.json().catch(() => ({}));
    return { status: r.status(), body: json };
  };
}

// ---- this run's records -----------------------------------------------------
// global-setup.js creates a fresh set of records through the API at the start
// of every run (backend/tests/live/fixtures.js createRun(), tagged with a run
// id) and writes their ids to e2e/.auth/run.json. Specs use only those — never
// the seeded AM-C / AM-L rows, which earlier runs have already moved.
export const RUN_FILE = path.join(here, ".auth", "run.json");

export function loadRun() {
  if (!fs.existsSync(RUN_FILE)) throw new Error("No run.json: global-setup did not create this run's records.");
  return JSON.parse(fs.readFileSync(RUN_FILE, "utf8"));
}

function runId(kind, key) {
  const rec = loadRun()[kind]?.[key];
  if (!rec?.id) throw new Error(`This run has no ${kind} ${key} (backend/tests/live/fixtures.js).`);
  return rec.id;
}

/** This run's complaint <key> (C01..), read as amit (whole company): { Id, Subject, TicketNo, ... }. */
export async function complaint(request, key) {
  const TicketId = runId("complaints", key);
  const r = await api(request, "amit")("/api/tickets/fetchTicketDetail", { TicketId });
  const t = r.body?.data?.ticket;
  if (!t) throw new Error(`complaint ${key} (${TicketId}) not readable by am_amit: ${r.status} ${r.body?.message ?? ""}`);
  return t;
}

/** This run's lead <key> (L01..), read as amit: { Id, Name, ... }. */
export async function lead(request, key) {
  const LeadId = runId("leads", key);
  const r = await api(request, "amit")("/api/leads/fetchLeadDetail", { LeadId });
  const l = r.body?.data?.lead;
  if (!l) throw new Error(`lead ${key} (${LeadId}) not readable by am_amit: ${r.status} ${r.body?.message ?? ""}`);
  return l;
}

/** This run's customer <key> (HO / ND / SE), read as amit: { Id, Name, ... }. */
export async function customer(request, key) {
  const CustomerId = runId("customers", key);
  const r = await api(request, "amit")("/api/customers/fetchCustomerDetail", { CustomerId });
  const c = r.body?.data?.customer;
  if (!c) throw new Error(`customer ${key} (${CustomerId}) not readable by am_amit: ${r.status} ${r.body?.message ?? ""}`);
  return c;
}

/** Persona user id by username (am_<name>). */
export async function userId(request, persona, who) {
  const r = await api(request, persona)("/api/users/fetchUsers", { SearchTerm: "AM ", PageSize: 200 });
  const u = (r.body?.data?.users ?? []).find((x) => x.Username === `am_${who}`);
  if (!u) throw new Error(`am_${who} not found`);
  return u.Id;
}

/** First step of every spec: the saved session still opens the app (not the sign-in screen). */
export async function expectSignedIn(page, persona) {
  await page.goto("./");
  const signIn = page.getByRole("button", { name: /^(Sign in|Continue)$/ });
  await page.waitForLoadState("networkidle");
  if (await signIn.isVisible().catch(() => false)) {
    throw new Error(`sign in again: PERSONA=${persona} pnpm e2e:auth`);
  }
}

// §4 words: never on these screens. Checked on the page body and any open dialog.
const BANNED = [/\bTransfer\b/, /\bOwner\b/, /\bLead owner\b/i, /\bAssignee\b/, /\bNew assignee\b/i,
  /\bBranch\b/, /Keep current branch/i, /Sent back to manager/i];

/** The visited screen carries none of the retired words (main content + dialogs; the nav is not a record screen). */
export async function expectWords(page) {
  await page.waitForLoadState("networkidle");
  const parts = await page.locator("main, [role=dialog]").allInnerTexts();
  const text = parts.join("\n");
  for (const word of BANNED) expect(text, `retired word ${word} on ${page.url()}`).not.toMatch(word);
}

/** Pick an option in a ui/Combobox by its data-testid and the option's visible name. */
export async function pick(page, testId, name) {
  const input = page.getByTestId(`${testId}-input`);
  await input.click();
  const option = page.getByRole("option", { name });
  await option.first().click();
}

/** The notistack snackbar with this text. */
export const snackbar = (page, text) => page.locator("#notistack-snackbar").filter({ hasText: text }).first();

/** Fill the reassign dialog's reason (first one offered) and remarks. */
export async function reasonAndRemarks(page, prefix, remarks) {
  await page.getByTestId(`${prefix}-reason-input`).click();
  await page.getByRole("option").first().click();
  await page.getByTestId(`${prefix}-remarks`).fill(remarks);
}

/** Type into a server table's search box (material-react-table toolbar). */
export async function search(page, text) {
  const box = page.locator("main input[placeholder^='Search']").first();
  const toggle = page.getByRole("button", { name: /Show\/Hide search/ }).first();
  await box.or(toggle).first().waitFor(); // the table toolbar renders after the first fetch
  if (!(await box.isVisible())) await toggle.click();
  await box.fill(text);
  await page.waitForTimeout(600); // the table debounces its search
  await page.waitForLoadState("networkidle");
}

/** The body rows of the page's table that contain `text`. */
export const rows = (page, text) => page.locator("main tbody tr").filter({ hasText: text });
