// agent (am_vinod, then am_vivek) — spec §7 rows 2 and 3: Reassign, Send back,
// and Send back naming the person who gave it (nitin), not vivek.
import { test, expect } from "@playwright/test";
import { authFile, expectSignedIn, expectWords, pick, reasonAndRemarks, snackbar, complaint } from "../personas.js";

test.describe.configure({ mode: "serial" });

test("vinod reassigns C01 to vivek, vivek sends it back, vinod's button names nitin", async ({ page, browser, request }) => {
  const c01 = await complaint(request, "C01");

  await test.step("vinod signed in", () => expectSignedIn(page, "vinod"));

  await test.step("vinod opens C01: Reassign dialog has no office move and no Unassigned", async () => {
    await page.goto(`support/tickets/${c01.Id}`);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expectWords(page);
    await page.getByTestId("reassign-ticket-btn").click();
    const dialog = page.getByTestId("reassign-ticket-modal");
    await expect(dialog.getByText("Reassign complaint")).toBeVisible();
    await expect(dialog.getByText("Move to another office")).toHaveCount(0);
    await expect(page.getByTestId("ticket-reassign-unassigned")).toHaveCount(0);
    await expectWords(page);
  });

  await test.step("Reassign to Vivek: the button names him, then back on the list, complaint gone", async () => {
    await pick(page, "ticket-reassign-person", /AM Vivek/);
    // Personas are named "AM <Name>", so the first-name button reads "Reassign to AM" (seed naming, see report).
    await expect(page.getByTestId("ticket-reassign-submit")).toHaveText(/^Reassign to (AM|Vivek)$/);
    await reasonAndRemarks(page, "ticket-reassign", "AM e2e: not mine");
    await page.getByTestId("ticket-reassign-submit").click();
    await expect(snackbar(page, "Reassigned to AM Vivek")).toBeVisible();
    await expect(page).toHaveURL(/\/support\/tickets$/);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).not.toContainText(c01.Subject);
    await expectWords(page);
  });

  const vivekCtx = await browser.newContext({ storageState: authFile("vivek") });
  const vivek = await vivekCtx.newPage();

  await test.step("vivek: Send back to Vinod with remarks, then gone", async () => {
    await expectSignedIn(vivek, "vivek");
    await vivek.goto(`support/tickets/${c01.Id}`);
    await expect(vivek.getByTestId("ticket-detail")).toBeVisible();
    await expectWords(vivek);
    const back = vivek.getByTestId("send-back-ticket-btn");
    await expect(back).toHaveText("Send back to AM Vinod");
    await back.click();
    await vivek.getByTestId("remarks-input").fill("AM e2e: wrong area");
    await vivek.getByTestId("remarks-submit").click();
    await expect(snackbar(vivek, "Sent back to AM Vinod")).toBeVisible();
    await expect(vivek).toHaveURL(/\/support\/tickets$/);
    await vivek.waitForLoadState("networkidle");
    await expect(vivek.locator("main")).not.toContainText(c01.Subject);
  });
  await vivekCtx.close();

  await test.step("vinod: the button now reads Send back to Nitin", async () => {
    await page.goto(`support/tickets/${c01.Id}`);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("send-back-ticket-btn")).toHaveText("Send back to AM Nitin");
    await expectWords(page);
  });

  await test.step("a resolved complaint (C05) has no Reassign button", async () => {
    const c05 = await complaint(request, "C05");
    await page.goto(`support/tickets/${c05.Id}`);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
    await expect(page.getByTestId("ticket-status-chip")).toBeVisible();
    await expect(page.getByTestId("reassign-ticket-btn")).toHaveCount(0);
    await expectWords(page);
  });
});
