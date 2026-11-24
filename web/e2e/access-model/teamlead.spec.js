// teamlead (am_rohit, Support Team Lead) — spec §7 rows 4, 11, 14 and §5.1:
// sees his team's complaints, opens the one escalated to him, bulk-reassigns,
// may reopen a team member's resolved complaint but never his own.
import { test, expect } from "@playwright/test";
import { expectSignedIn, expectWords, pick, reasonAndRemarks, rows, search, complaint } from "../personas.js";

test.describe.configure({ mode: "serial" });

const tab = (page, name) => page.getByTestId("ticket-presets").getByRole("tab", { name, exact: true }).click();

test("rohit works his team's complaints", async ({ page, request }) => {
  await test.step("signed in", () => expectSignedIn(page, "rohit"));

  await test.step("My team shows vinod's complaints; vivek's resolved one is there under All", async () => {
    await page.goto("support/tickets");
    await tab(page, "My team");
    await page.waitForLoadState("networkidle");
    await expect(rows(page, "AM Vinod").first()).toBeVisible();
    await expectWords(page);
    await tab(page, "All");
    const c06 = await complaint(request, "C06");
    await search(page, c06.Subject);
    await expect(rows(page, c06.Subject)).toHaveCount(1);
    await expect(rows(page, c06.Subject)).toContainText("AM Vivek");
  });

  await test.step("opens the complaint escalated to him (C04)", async () => {
    const c04 = await complaint(request, "C04");
    await page.goto("support/tickets");
    await tab(page, "Escalated");
    await search(page, c04.Subject);
    await rows(page, c04.Subject).first().click();
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("ticket-escalated-chip")).toHaveText("Escalated to AM Rohit");
    await expectWords(page);
  });

  await test.step("selects five, Reassign 5 complaints -> Vivek", async () => {
    await page.goto("support/tickets");
    await tab(page, "My team");
    const five = await Promise.all(["C08", "C09", "C10", "C11", "C12"].map((k) => complaint(request, k)));
    // One search per complaint; the table keeps the selection by row id across searches.
    for (const t of five) {
      await search(page, t.Subject);
      await rows(page, t.Subject).getByRole("checkbox").check();
    }
    await expect(page.getByTestId("bulk-reassign-btn")).toHaveText("Reassign 5");
    await page.getByTestId("bulk-reassign-btn").click();
    const dialog = page.getByTestId("reassign-ticket-modal");
    await expect(dialog.getByText("Reassign 5 complaints")).toBeVisible();
    await expectWords(page);
    await pick(page, "ticket-reassign-person", /AM Vivek/);
    await expect(page.getByTestId("ticket-reassign-submit")).toHaveText(/^Reassign to (AM|Vivek)$/);
    await reasonAndRemarks(page, "ticket-reassign", "AM e2e: vinod away");
    await page.getByTestId("ticket-reassign-submit").click();
    await expect(dialog).toHaveCount(0);
    for (const t of five) {
      await search(page, t.Subject);
      await expect(rows(page, t.Subject)).toContainText("AM Vivek");
    }
  });

  await test.step("Reopen on a team member's resolved complaint (C05), not on his own (C18)", async () => {
    const c05 = await complaint(request, "C05");
    await page.goto(`support/tickets/${c05.Id}`);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("reopen-ticket-btn")).toBeVisible();
    await expectWords(page);
    const c18 = await complaint(request, "C18");
    await page.goto(`support/tickets/${c18.Id}`);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("ticket-status-chip")).toBeVisible();
    await expect(page.getByTestId("reopen-ticket-btn")).toHaveCount(0);
  });
});
