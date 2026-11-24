// e2e/solartest/calling.spec.js — calling lists through the real web screens on
// SolarTest. Amit makes a list, uploads the fake .xlsx, checks the column mapping
// and the preview counts, hands out, walks the list's tabs, the Do not call page
// and the Calling report. Then a salesperson (Sarika) and two support people
// (Nitin, Rohit): no Calling lists / Do not call in their menu, the pages refuse
// them, and no cost anywhere.
//
// Run: pnpm exec playwright test -c playwright.solartest.config.js calling.spec
// Screenshots go to $CALLING_SHOTS (default test-results/calling-shots).
import path from "node:path";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { signIn } from "./solartest.js";
import { PEOPLE, must, proveSolarTest, leftovers, nextBlock, openHours, restoreHours, today, recorder } from "./calling-run.js";
import { writeSheet } from "./calling-fixtures.mjs";

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.CALLING_SHOTS ?? path.join("test-results", "calling-shots");
const rec = recorder("web");
const REFUSED = /don't have access to this page|managed by your manager|not found/i;
const S = {};
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `web-b${S.block}-${name}.png`), fullPage: true });
};
/** A hard expect, recorded first (the run report reads the record). */
async function step(name, fn) {
  try { await test.step(name, fn); rec.add(name, true); } catch (e) { rec.add(name, false, e.message.split("\n")[0]); throw e; }
}

/** Every sidebar title the person has, parents expanded. */
async function menuTitles(page) {
  await page.goto("./");
  await page.locator("[data-testid^=sidebar-]").first().waitFor();
  const ids = () => page.locator("[data-testid^=sidebar-]").evaluateAll((els) => els.map((e) => e.dataset.testid));
  for (const id of await ids()) {
    if (["sidebar-brand", "sidebar-toggle"].includes(id)) continue;
    const url = page.url();
    await page.getByTestId(id).first().click().catch(() => {});
    await page.waitForTimeout(250);
    if (page.url() !== url) await page.goBack();
  }
  return (await ids()).map((t) => t.replace(/^sidebar-/, ""));
}

test.beforeAll(async () => {
  await proveSolarTest();
  await leftovers();
  await openHours();
  S.block = await nextBlock();
  S.tag = `CALLTEST b${S.block}`;
  S.dir = path.join(SHOTS, `sheet-b${S.block}`);
  S.sheet = writeSheet(S.dir, S.block);
  await must("amit", "/api/leads/saveLeads", { Id: 0, Name: `${S.tag} existing lead FAKE`, MobileNo: S.sheet.numbers.lead, FirstFollowupAt: `${today(1)}T11:00:00` });
  await must("amit", "/api/phoneMark/set", { Mobile: S.sheet.numbers.dnc, Mark: "dnc", Note: `${S.tag} web run dnc` });
});

test.afterAll(async () => {
  rec.flush();
  await leftovers().catch(() => {});
  await restoreHours().catch(() => {});
});

test("Amit: new list, upload the .xlsx, mapping, preview, import, hand out", async ({ browser }) => {
  const { ctx, page } = await signIn(browser, "amit");
  S.amit = { ctx, page };
  await step("Calling lists page opens", async () => {
    await page.goto("sales/calling-lists");
    await expect(page.getByTestId("new-list-btn")).toBeVisible();
    await shot(page, "01-lists");
  });
  await step("step 1: details, with cost (admin)", async () => {
    await page.getByTestId("new-list-btn").click();
    await page.getByTestId("list-Name").fill(`${S.tag} WEB`);
    const office = page.getByTestId("list-BranchId-input");
    if (!(await office.inputValue())) { await office.click(); await page.getByRole("option").first().click(); }
    await page.getByTestId("list-Vendor").fill("Fake Data Co (test)");
    await expect(page.getByTestId("list-Cost")).toBeVisible();
    await page.getByTestId("list-Cost").fill("2500");
    await shot(page, "02-details");
    await page.getByTestId("list-next").click();
    await expect(page.getByTestId("sheet-file")).toBeAttached();
  });
  await step("step 2: the .xlsx is read and mapped Contact→Mobile, Mobile2→Alt mobile, Address→Address, rest extra", async () => {
    await page.getByTestId("sheet-file").setInputFiles(path.join(S.dir, "solar-contacts.xlsx"));
    const want = ["Keep as extra", "Name", "Keep as extra", "Mobile", "Alt mobile", "Address", "Keep as extra", "Keep as extra"];
    for (let j = 0; j < want.length; j += 1) await expect(page.getByTestId(`map-${j}-input`)).toHaveValue(want[j]);
    await shot(page, "03-mapping");
  });
  await step("preview counts: 51 added, 3 repeated, 4 bad, 1 already a lead, 1 do not call", async () => {
    await page.getByTestId("preview-btn").click();
    const e = S.sheet.expect;
    for (const [k, v] of [["Added", e.Added], ["Repeated", e.repeated], ["BadNumber", e.BadNumber], ["IsLead", e.IsLead], ["Dnc", e.Dnc], ["InPool", 0], ["IsCustomer", 0]]) {
      await expect(page.getByTestId(`count-${k}`)).toContainText(String(v));
    }
    await expect(page.getByTestId("preview-row-1").locator("td").nth(3)).toHaveText(S.sheet.numbers.alts[0]);   // Mobile2 shown as Alt mobile
    await shot(page, "04-preview");
  });
  await step("import: 51 contacts added", async () => {
    await page.getByTestId("import-btn").click();
    await expect(page.getByTestId("import-done")).toContainText("51 contacts added");
    await page.getByTestId("sheet-next").click();
  });
  await step("step 3: give Sarika 5 and Tanu 5", async () => {
    await page.getByTestId(`give-${PEOPLE.sarika.id}`).fill("5");
    await page.getByTestId(`give-${PEOPLE.tanu.id}`).fill("5");
    // Support people cannot add leads, so they are not offered as callers.
    for (const k of ["nitin", "rohit", "vinod", "vivek", "prasant"]) await expect(page.getByTestId(`caller-${PEOPLE[k].id}`)).toHaveCount(0);
    await shot(page, "05-callers");
    await page.getByTestId("callers-save").click();
    await expect(page.getByTestId("callers-result")).toBeVisible();
    await page.getByTestId("callers-done").click();
  });
  const list = (await must("amit", "/api/calling/fetchLists", { SearchTerm: `${S.tag} WEB` })).lists[0];
  S.list = list;
  await step("API agrees: 51 contacts, 10 with callers, cost 2500", async () => {
    expect(Number(list.Contacts)).toBe(51);
    expect(Number(list.Held)).toBe(10);
    expect(Number(list.Cost)).toBe(2500);
  });
  await step("uploaded through the web: empty Contact → Mobile2 is the mobile; two numbers in a cell → mobile + alt", async () => {
    const all = (await must("amit", "/api/calling/fetchContacts", { CallListId: list.Id, PageSize: 500 })).contacts;
    for (const n of S.sheet.numbers.altOnly) {
      const c = all.find((x) => x.Mobile === n);
      expect(c, `contact on ${n}`).toBeTruthy();
      expect(c.AltMobile).toBeNull();
    }
    expect(all.find((c) => c.Mobile === S.sheet.numbers.twoInCell[0])?.AltMobile).toBe(S.sheet.numbers.twoInCell[1]);
    expect(all.map((c) => c.Mobile).sort()).toEqual([...S.sheet.numbers.pooled].sort());
  });
});

test("Amit: list detail tabs, Do not call page, Calling report", async () => {
  const { page } = S.amit;
  await step("Overview shows the money panel with the cost", async () => {
    await page.goto(`sales/calling-lists/${S.list.Id}`);
    await expect(page.getByTestId("money")).toContainText("2,500");
    await shot(page, "06-overview");
  });
  for (const tab of ["contacts", "callers", "settings"]) {
    await step(`tab ${tab}`, async () => {
      await page.goto(`sales/calling-lists/${S.list.Id}?tab=${tab}`);
      await page.waitForLoadState("networkidle");
      if (tab === "callers") {
        await expect(page.getByTestId(`caller-row-${PEOPLE.sarika.id}`)).toContainText("5");
        await expect(page.getByTestId(`caller-row-${PEOPLE.tanu.id}`)).toContainText("5");
      }
      if (tab === "contacts") await expect(page.locator("main tbody tr").first()).toBeVisible();
      if (tab === "settings") await expect(page.getByTestId("set-Cost")).toBeVisible();
      await shot(page, `07-${tab}`);
    });
  }
  await step("Do not call page lists the run's marked number", async () => {
    await page.goto("sales/do-not-call");
    await expect(page.getByTestId("add-number-btn")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const box = page.locator("main input[placeholder^='Search']").first();
    const toggle = page.getByRole("button", { name: /Show\/Hide search/ }).first();
    await box.or(toggle).first().waitFor();
    if (!(await box.isVisible())) await toggle.click();
    await box.fill(S.sheet.numbers.dnc);
    await expect(page.locator("main tbody tr").filter({ hasText: S.sheet.numbers.dnc })).toHaveCount(1);
    await shot(page, "08-do-not-call");
  });
  await step("Calling report, by caller: Sarika and tanu are lines", async () => {
    await page.goto("reports/sales/calling?preset=any");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toContainText("Sarika");
    await shot(page, "09a-calling-report-callers");
  });
  await step("Calling report, by list (any time): the list with its cost (Owner)", async () => {
    await page.goto("reports/sales/calling?line=calllist&preset=any");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toContainText(S.list.Name);
    await expect(page.locator("main")).toContainText("2,500");
    await shot(page, "09b-calling-report-lists");
  });
  await S.amit.ctx.close();
});

for (const who of ["sarika", "nitin", "rohit"]) {
  test(`${who}: no Calling lists or Do not call; the pages refuse; no cost`, async ({ browser }) => {
    const { ctx, page } = await signIn(browser, who);
    await step(`${who}: menu has no Calling lists / Do not call`, async () => {
      const titles = await menuTitles(page);
      expect(titles.filter((t) => /calling list|do not call/i.test(t))).toEqual([]);
      await shot(page, `10-${who}-menu`);
    });
    for (const [label, url] of [["lists", "sales/calling-lists"], ["detail", `sales/calling-lists/${S.list.Id}`], ["dnc", "sales/do-not-call"]]) {
      await step(`${who}: ${label} page refuses`, async () => {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        // The no-access page, or (salespeople) the designed "managed by your manager" page.
        await expect(page.getByText(REFUSED).first()).toBeVisible();
        await expect(page.locator("body")).not.toContainText(S.list.Name);
        for (const n of S.sheet.numbers.pooled.slice(0, 10)) await expect(page.locator("body")).not.toContainText(n);
        await expect(page.locator("body")).not.toContainText("2,500");
        await shot(page, `11-${who}-${label}`);
      });
    }
    await step(`${who}: Calling report — ${PEOPLE[who].kind === "sales" ? "own calls only, no cost, no numbers" : "refused"}`, async () => {
      await page.goto("reports/sales/calling?line=calllist&preset=any");
      await page.waitForLoadState("networkidle");
      if (PEOPLE[who].kind === "support") {
        await expect(page.getByText(/don't have access to this page/i)).toBeVisible();
      } else {
        await expect(page.locator("main")).toContainText(/Calls made in/);   // loaded, not a spinner
        await expect(page.locator("main")).toContainText(/\d+ calling lists?|Nothing in this period/, { timeout: 30_000 });   // data, not the skeleton
        await expect(page.locator("main")).not.toContainText(S.list.Name);   // not a list she manages, no calls on it
        await expect(page.locator("main")).not.toContainText("2,500");
        await expect(page.locator("main")).not.toContainText(/Cost|per lead/i);
        for (const n of S.sheet.numbers.all) await expect(page.locator("body")).not.toContainText(n);
      }
      await shot(page, `12-${who}-report`);
    });
    if (PEOPLE[who].kind === "sales") {
      await step(`${who}: Leads list carries none of the pool's numbers`, async () => {
        await page.goto("sales/leads");
        await page.waitForLoadState("networkidle");
        for (const n of S.sheet.numbers.pooled.slice(0, 10)) await expect(page.locator("body")).not.toContainText(n);
      });
    }
    await ctx.close();
  });
}
