// Screen click-through: every SolarTest person signs in, opens every sidebar
// entry and every tab on each page, a screenshot each. Records menus, pages,
// error toasts / 5xx / access-refused pages, and rows that are not theirs.
// Read only: nothing is saved. Output: SCREENS_DIR (screenshots + web-results.json).
import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { P, signIn } from "./solartest.js";

const OUT = process.env.SCREENS_DIR;
const ROLE = {
  amit: "owner", neha: "manager",
  deeksha: "sales", roshan: "sales", kasak: "sales", sarika: "sales", tanu: "sales", ashish: "sales", pawan: "sales",
  nitin: "support", prasant: "support", rohit: "support", vinod: "support", vivek: "support",
};
const results = {};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

test.describe.configure({ mode: "serial" });
test.skip(!OUT, "set SCREENS_DIR");
test.afterAll(() => { if (OUT) fs.writeFileSync(path.join(OUT, "web-results.json"), JSON.stringify(results, null, 2)); });

for (const who of Object.keys(ROLE)) {
  test(`screens: ${who}`, async ({ browser }) => {
    test.setTimeout(600_000);
    const dir = path.join(OUT, who); fs.mkdirSync(dir, { recursive: true });
    const r = (results[who] = { role: ROLE[who], menus: [], pages: [], errors: [], flags: [] });
    const { ctx, page } = await signIn(browser, who);
    page.on("response", (res) => {
      if (res.url().startsWith("http://localhost:5001/api/") && res.status() >= 500) r.errors.push(`${res.status()} ${new URL(res.url()).pathname} on ${page.url()}`);
    });
    let n = 0;
    const shot = async (label) => {
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(400);
      const toasts = await page.locator("#notistack-snackbar").allInnerTexts().catch(() => []);
      const errToasts = await page.locator(".notistack-MuiContent-error, [class*=variantError]").allInnerTexts().catch(() => []);
      for (const t of errToasts) r.errors.push(`error toast "${t.trim()}" on ${label}`);
      const body = await page.locator("main").innerText().catch(() => "");
      if (/You don't have access to this page|Something went wrong|Page not found/i.test(body)) r.errors.push(`refusal/error page on ${label}: ${body.match(/You don't have access to this page|Something went wrong|Page not found/i)[0]}`);
      await page.screenshot({ path: path.join(dir, `web-${String(++n).padStart(2, "0")}-${slug(label)}.png`) });
      r.pages.push({ label, url: page.url().replace("http://localhost:8080/prdcrm", ""), toasts: toasts.map((t) => t.trim()).filter(Boolean) });
    };
    /** The "Assigned to" column of the page's table: names not this person's (sales/support only). */
    const foreignRows = async (label) => {
      if (!["sales", "support"].includes(ROLE[who])) return;
      if (/Logged by me/.test(label)) return; // by design: what they logged, wherever it went
      const heads = (await page.locator("main thead th").allInnerTexts().catch(() => [])).map((h) => h.trim().toLowerCase());
      const i = heads.findIndex((h) => h === "assigned to");
      if (i < 0) return;
      const names = await page.locator(`main tbody tr td:nth-child(${i + 1})`).allInnerTexts().catch(() => []);
      const mine = P[who].name.trim().toLowerCase();
      const other = [...new Set(names.map((x) => x.trim()).filter((x) => x && x !== "—" && x.toLowerCase() !== mine && !/^unassigned$/i.test(x)))];
      if (other.length) r.flags.push(`${label}: rows assigned to ${other.join(", ")}`);
    };

    await page.goto("./"); await page.waitForLoadState("networkidle");
    // Expand every parent; a click that does not change the URL opened children.
    const ids = async () => page.locator("[data-testid^=sidebar-]").evaluateAll((els) => els.map((e) => e.dataset.testid));
    const skip = new Set(["sidebar-brand", "sidebar-toggle"]);
    const parentOf = {};
    for (const id of (await ids()).filter((x) => !skip.has(x))) {
      const before = new Set(await ids()); const url = page.url();
      await page.getByTestId(id).first().click(); await page.waitForTimeout(300);
      if (page.url() === url) for (const c of await ids()) if (!before.has(c)) parentOf[c] = id;
    }
    const all = (await ids()).filter((x) => !skip.has(x));
    const parents = new Set(Object.values(parentOf));
    r.menus = all.map((id) => (parentOf[id] ? `${parentOf[id].slice(8)} › ${id.slice(8)}` : id.slice(8)));
    for (const id of all.filter((x) => !parents.has(x))) {
      const label = parentOf[id] ? `${parentOf[id].slice(8)} › ${id.slice(8)}` : id.slice(8);
      if (!(await page.getByTestId(id).first().isVisible().catch(() => false)) && parentOf[id]) await page.getByTestId(parentOf[id]).first().click();
      const was = page.url();
      await page.getByTestId(id).first().click();
      await page.waitForURL((u) => u.toString() !== was, { timeout: 8000 }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1200); // tabs and tables render after the first fetch
      await shot(label);
      await foreignRows(label);
      const tabs = page.locator("main [role=tab]");
      const count = await tabs.count();
      for (let t = 1; t < count; t++) {
        const name = (await tabs.nth(t).innerText().catch(() => "")).trim().replace(/\s+/g, " ");
        if (!name || !(await tabs.nth(t).isVisible().catch(() => false))) continue;
        await tabs.nth(t).click().catch(() => {});
        await page.waitForTimeout(800);
        await shot(`${label} › ${name}`);
        await foreignRows(`${label} › ${name}`);
      }
    }
    // Role rules on the menu titles.
    const m = r.menus.join(" | ");
    if (ROLE[who] === "sales" && /complaint|customer|support/i.test(m)) r.flags.push(`tele-caller has ${m.match(/[^|]*(complaint|customer|support)[^|]*/i)[0].trim()}`);
    if (ROLE[who] === "support" && /lead|sales/i.test(m)) r.flags.push(`support has ${m.match(/[^|]*(lead|sales)[^|]*/i)[0].trim()}`);
    if (who !== "amit" && /admin|users|roles|permission/i.test(m)) r.flags.push(`non-owner has ${m.match(/[^|]*(admin|users|roles|permission)[^|]*/i)[0].trim()}`);
    await ctx.close();
  });
}
