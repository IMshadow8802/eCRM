// e2e/solartest/solartest.js — helpers for the SolarTest run (a private copy of
// the SolarCRM client DB, served by the owner's backend on localhost:5001).
// Real people, real usernames (several end in a space), the test-only password
// from backend/.env.live (read via personas.livePassword, never printed).
//
// Guard: the web is localhost:8080 and the API base the sign-in screen ends up
// with must be exactly http://localhost:5001 — checked before a password is
// typed. global-setup.js proves the DB is SolarTest (that password signs in
// only there).
import { expect } from "@playwright/test";
import { livePassword } from "../personas.js";

export const API = "http://localhost:5001";
export const WEB_URL = "http://localhost:8080/prdcrm/";

// Exact usernames (trailing spaces matter) and the names the screens show.
export const P = {
  amit: { u: "Amit", name: "Amit" },
  roshan: { u: "Roshan", name: "Roshan" },
  kasak: { u: "Kasak ", name: "Kasak" },
  neha: { u: "Neha ", name: "Neha Yadav" },
  nitin: { u: "Nitin ", name: "Nitin Kumar" },
  prasant: { u: "Prasant ", name: "Prasant" },
  rohit: { u: "Rohit ", name: "ROHIT GAUR" },
  vinod: { u: "Vinod ", name: "Vinod Kumar" },
  vivek: { u: "Vivek", name: "Vivek Kumar" },
};

/** API sign-in (for looking records up, never for the action under test). */
const tokens = {};
export async function token(who) {
  if (tokens[who]) return tokens[who];
  const r = await fetch(`${API}/api/auth/loginUser`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: P[who].u, password: livePassword() }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200 || !j?.data?.token) throw new Error(`API sign-in failed for ${who}: ${r.status}`);
  return (tokens[who] = j.data.token);
}
export async function api(who, route, body = {}) {
  const r = await fetch(API + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(who)}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** A fresh browser context signed in as `who` through the real sign-in screen. */
export async function signIn(browser, who) {
  const ctx = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 1600, height: 1000 } });
  // Bind the company to localhost:5001 the way the code step would (no Central
  // call); the store keeps it only because the dev override trusts that origin.
  await ctx.addInitScript((api) => {
    if (localStorage.getItem("auth-storage-eCRM")) return;
    localStorage.setItem("auth-storage-eCRM", JSON.stringify({ version: 4, state: {
      API_BASE_URL: api, compCode: "SOLARTEST", companyName: "SolarTest", logoURL: null, isClientConfigured: true } }));
  }, API);
  const page = await ctx.newPage();
  await page.goto("login");
  await expect(page.locator("input[name=password]")).toBeVisible();
  const base = await page.evaluate(() => JSON.parse(localStorage.getItem("auth-storage-eCRM") ?? "{}")?.state?.API_BASE_URL);
  if (base !== API) throw new Error(`refused: the sign-in screen points at ${base}, not ${API}`);
  await page.locator("input[name=identifier]").fill(P[who].u);
  await page.locator("input[name=password]").fill(livePassword());
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  const notice = page.getByTestId("presence-notice");
  if (await notice.waitFor({ timeout: 2500 }).then(() => true, () => false)) await page.getByRole("button", { name: "OK" }).click();
  return { ctx, page };
}

/** Pick an option in a ui/Combobox by its data-testid, typing `type` first if given. */
export async function pick(page, testId, name, type) {
  const input = page.getByTestId(`${testId}-input`);
  await input.click();
  if (type) await input.fill(type);
  await page.getByRole("option", { name }).first().click();
}

export const snackbar = (page, text) => page.locator("#notistack-snackbar").filter({ hasText: text }).first();

export async function reasonAndRemarks(page, prefix, remarks) {
  await page.getByTestId(`${prefix}-reason-input`).click();
  await page.getByRole("option").first().click();
  await page.getByTestId(`${prefix}-remarks`).fill(remarks);
}

export async function search(page, text) {
  const box = page.locator("main input[placeholder^='Search']").first();
  const toggle = page.getByRole("button", { name: /Show\/Hide search/ }).first();
  await box.or(toggle).first().waitFor();
  if (!(await box.isVisible())) await toggle.click();
  await box.fill(text);
  await page.waitForTimeout(700);
  await page.waitForLoadState("networkidle");
}

export const rows = (page, text) => page.locator("main tbody tr").filter({ hasText: text });
