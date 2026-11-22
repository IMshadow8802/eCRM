// manager (am_neha, Branch Manager) — spec §7 rows 7, 9, 14, 16 and §5.1:
// the office's Unassigned list, office-wide reassign options, Follow-ups,
// the sales Team report with every tele-caller, and Reopen.
import { test, expect } from "@playwright/test";
import { expectSignedIn, expectWords, rows, search, snackbar, complaint, lead } from "../personas.js";

test.describe.configure({ mode: "serial" });

const tab = (page, name) => page.getByTestId("ticket-presets").getByRole("tab", { name, exact: true }).click();

test("neha manages the office", async ({ page, request }) => {
  await test.step("signed in", () => expectSignedIn(page, "neha"));

  const c02 = await complaint(request, "C02");
  await test.step("Unassigned shows the complaint still with its logger (C02)", async () => {
    await page.goto("support/tickets");
    await tab(page, "Unassigned");
    await search(page, c02.Subject);
    await expect(rows(page, c02.Subject)).toHaveCount(1);
    await expect(rows(page, c02.Subject)).toContainText("Unassigned");
    await expectWords(page);
  });

  await test.step("her reassign dialog offers Unassigned and Move to another office", async () => {
    await rows(page, c02.Subject).click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expectWords(page);
    await page.getByTestId("reassign-ticket-btn").click();
    const dialog = page.getByTestId("reassign-ticket-modal");
    await expect(dialog.getByText("Unassigned", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Move to another office")).toBeVisible();
    await expectWords(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("Follow-ups page", async () => {
    await page.goto("sales/follow-ups");
    await expect(page.getByRole("heading", { name: "Follow-ups" })).toBeVisible();
    await page.getByRole("tab", { name: "All", exact: true }).click();
    const l01 = await lead(request, "L01");
    await search(page, l01.Name);
    await expect(rows(page, l01.Name).first()).toBeVisible();
    await expectWords(page);
  });

  await test.step("sales Team report shows every tele-caller's line", async () => {
    await page.goto("reports/sales/team");
    await page.waitForLoadState("networkidle");
    const table = page.getByTestId("sales-team-table");
    await expect(table).toContainText("AM Kasak");
    await expect(table).toContainText("AM Roshan");
    await expectWords(page);
  });

  await test.step("reopens a resolved complaint (C06)", async () => {
    const c06 = await complaint(request, "C06");
    await page.goto(`support/tickets/${c06.Id}`);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await page.getByTestId("reopen-ticket-btn").click();
    await page.getByTestId("remarks-input").fill("AM e2e: customer says it is not fixed");
    await page.getByTestId("remarks-submit").click();
    await expect(snackbar(page, "Status updated")).toBeVisible();
    await expect(page.getByTestId("reopen-ticket-btn")).toHaveCount(0);
    await expect(page.getByTestId("resolve-ticket-btn")).toBeVisible();
    await expectWords(page);
  });
});
