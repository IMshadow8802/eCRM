// desk (am_nitin, call desk) — spec §7 rows 1, 8, 15 and the "Away today" mark (D25).
import { test, expect } from "@playwright/test";
import { api, customer, expectSignedIn, expectWords, pick, snackbar, userId } from "../personas.js";

const SUBJECT = `AM-W01 Desk logs for Vinod ${Date.now()}`;
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date

test.describe.configure({ mode: "serial" });

let vinodId;

test.beforeAll(async ({ request }) => {
  // "Away today" is not seeded (S14): amit marks vinod on leave for today, removed after.
  vinodId = await userId(request, "amit", "vinod");
  const r = await api(request, "amit")("/api/work/saveDayMark", {
    UserId: vinodId, WorkDate: today(), Part: "full", Kind: "leave", Remarks: "AM e2e",
  });
  expect(r.status, r.body?.message).toBe(200);
});

test.afterAll(async ({ request }) => {
  await api(request, "amit")("/api/work/deleteDayMark", { UserId: vinodId, WorkDate: today() });
});

test("nitin logs a complaint for vinod, then sees only its line", async ({ page, request }) => {
  await test.step("signed in", () => expectSignedIn(page, "nitin"));

  await test.step("complaints list carries the §4 words", async () => {
    await page.goto("support/tickets");
    await expect(page.getByRole("heading", { name: "Complaints" })).toBeVisible();
    await expectWords(page);
  });

  await test.step("New complaint: Assign to lists field staff, no tele-caller, Away today on vinod", async () => {
    await page.getByTestId("new-ticket-btn").click();
    const dialog = page.getByTestId("create-ticket-modal");
    await expect(dialog.getByText("Assign to")).toBeVisible();
    const ho = await customer(request, "HO");
    await page.getByTestId("customer-picker-input").fill(ho.Name);
    await page.getByRole("option", { name: ho.Name }).first().click();
    await page.getByTestId("ticket-subject").fill(SUBJECT);

    await page.getByTestId("ticket-assignee-input").click();
    const options = page.getByRole("option");
    await expect(options.filter({ hasText: "AM Vinod" })).toHaveCount(1);
    await expect(options.filter({ hasText: "AM Vivek" })).toHaveCount(1);
    await expect(options.filter({ hasText: "AM Kasak" })).toHaveCount(0);
    await expect(options.filter({ hasText: "AM Roshan" })).toHaveCount(0);
    await expect(options.filter({ hasText: "AM Vinod" }).getByText("Away today")).toBeVisible();
    await expect(options.filter({ hasText: "AM Vivek" }).getByText("Away today")).toHaveCount(0);
    await expectWords(page);
    await options.filter({ hasText: "AM Vinod" }).click();
  });

  await test.step("save: the snackbar names the person", async () => {
    await page.getByTestId("create-ticket-submit").click();
    await expect(snackbar(page, "Logged and assigned to AM Vinod")).toBeVisible();
  });

  await test.step("the complaint is not in his list", async () => {
    await page.goto("support/tickets");
    await page.getByTestId("ticket-presets").getByRole("tab", { name: "All" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).not.toContainText(SUBJECT);
    const r = await api(request, "nitin")("/api/tickets/fetchTickets", { SearchTerm: "AM-W01", PageSize: 50 });
    expect((r.body?.data?.tickets ?? []).filter((t) => t.Subject === SUBJECT)).toEqual([]);
  });

  await test.step("Logged by me: eight headers, the row is not a link", async () => {
    await page.getByTestId("ticket-presets").getByRole("tab", { name: "Logged by me" }).click();
    const table = page.getByTestId("logged-by-me");
    const row = table.locator("tbody tr").filter({ hasText: SUBJECT });
    await expect(row).toHaveCount(1);
    const headers = (await table.locator("thead th").allTextContents()).map((h) => h.trim()).filter(Boolean);
    expect(headers).toEqual(["Number", "Logged on", "Customer", "Subject", "Status", "Assigned to", "Due", "Resolved / closed"]);
    await expect(row).toContainText("AM Vinod");
    await expect(row.locator("a")).toHaveCount(0);
    await row.click();
    await expect(page).toHaveURL(/\/support\/tickets$/);
    await expectWords(page);
  });

  await test.step("opening its URL directly exits with 'This record is no longer with you'", async () => {
    const r = await api(request, "amit")("/api/tickets/fetchTickets", { SearchTerm: SUBJECT, PageSize: 5 });
    const t = (r.body?.data?.tickets ?? []).find((x) => x.Subject === SUBJECT);
    expect(t, "amit (whole company) sees the new complaint").toBeTruthy();
    await page.goto(`support/tickets/${t.Id}`);
    await expect(page).toHaveURL(/\/support\/tickets$/);
    await expect(snackbar(page, "This record is no longer with you")).toBeVisible();
    await expect(page.getByTestId("ticket-detail")).toHaveCount(0);
  });
});
