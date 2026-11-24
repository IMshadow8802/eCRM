// sales (am_kasak, then am_roshan, Sales Executives) — spec §7 rows 6, 9, 10, 18:
// Reassign lead, gone from every view of hers, closed leads are a manager's,
// and the receiver gets the lead, its quotation and "Send back to Kasak".
import { test, expect } from "@playwright/test";
import {
  api, authFile, expectSignedIn, expectWords, lead, pick, reasonAndRemarks, rows, search, snackbar, userId,
} from "../personas.js";

test.describe.configure({ mode: "serial" });

const day = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

/** Kasak drafts a quotation on the lead through the API (the builder is not under test here). */
async function draftQuotation(request, l) {
  const as = api(request, "kasak");
  const prof = await as("/api/quotations/ensureQuoteProfile", { LeadId: l.Id });
  expect(prof.status, prof.body?.message).toBe(200);
  const p = prof.body.data.profile ?? {};
  const q = await as("/api/quotations/saveQuotation", {
    Id: 0, LeadId: l.Id, TemplateCode: p.DefaultTemplate || "classic", QuoteDate: day(0), ValidTill: day(15),
    Subject: "AM e2e quote", ToName: l.Name, ToCompany: l.Company ?? "", ToMobile: l.MobileNo ?? "",
    ToEmail: l.Email ?? "", ToAddress: l.Address ?? "", ToCity: l.City ?? "", ToStateCode: "",
    ToPincode: l.Pincode ?? "", ToGSTIN: "",
    Company: {
      name: p.CompanyName ?? "", address: p.Address ?? "", city: p.City ?? "", stateCode: p.StateCode ?? "",
      pincode: p.Pincode ?? "", gstin: p.GSTIN ?? "", phone: p.Phone ?? "", email: p.Email ?? "",
      website: p.Website ?? "", bank: p.BankDetails ?? "", signatory: p.SignatoryName ?? "",
      logoAttachmentId: p.LogoAttachmentId ?? null, headerAttachmentId: p.HeaderAttachmentId ?? null,
      showLogo: true, showHeader: true, accent: p.AccentColor || "#1e3a8a",
    },
    Content: { intro: p.DefaultIntro ?? "", terms: p.DefaultTerms ?? "", notes: "", sections: [] },
    Lines: [{ productId: null, description: "AM panel", hsn: "", qty: 1, unit: "", rate: 100, discountType: "pct", discountValue: "", taxPct: 18 }],
  });
  expect(q.status, q.body?.message).toBe(200);
  return q.body.data.Id;
}

test("kasak hands L01 to roshan; it leaves every view of hers", async ({ page, browser, request }) => {
  const l01 = await lead(request, "L01");
  const quotationId = await draftQuotation(request, l01);

  await test.step("signed in", () => expectSignedIn(page, "kasak"));

  await test.step("Leads table has 'Assigned to'", async () => {
    await page.goto("sales/leads");
    await expect.poll(async () => (await page.locator("main thead th").allTextContents()).map((h) => h.trim()))
      .toContain("Assigned to");
    await expectWords(page);
  });

  await test.step("Reassign lead -> Reassign to Roshan -> back on the list, lead gone", async () => {
    await page.goto(`sales/leads/${l01.Id}`);
    await expect(page.getByTestId("lead-detail")).toBeVisible();
    await expectWords(page);
    await page.getByTestId("reassign-lead-btn").click();
    const dialog = page.getByTestId("reassign-lead-modal");
    await expect(dialog.getByText("Reassign lead")).toBeVisible();
    await expect(dialog.getByText("Move to another office")).toHaveCount(0);
    await expectWords(page);
    await pick(page, "reassign-person", /AM Roshan/);
    // "AM <Name>" personas: the first-name button reads "Reassign to AM" (seed naming, see report).
    await expect(page.getByTestId("reassign-submit")).toHaveText(/^Reassign to (AM|Roshan)$/);
    await reasonAndRemarks(page, "reassign", "AM e2e: handing over");
    await page.getByTestId("reassign-submit").click();
    await expect(snackbar(page, "Reassigned to AM Roshan")).toBeVisible();
    await expect(page).toHaveURL(/\/sales\/leads$/);
    await search(page, l01.Name);
    await expect(rows(page, l01.Name)).toHaveCount(0);
  });

  await test.step("its URL exits with 'This record is no longer with you'", async () => {
    await page.goto(`sales/leads/${l01.Id}`);
    await expect(page).toHaveURL(/\/sales\/leads$/);
    await expect(snackbar(page, "This record is no longer with you")).toBeVisible();
  });

  await test.step("Follow-ups -> All has no row for it", async () => {
    await page.goto("sales/follow-ups");
    await page.getByRole("tab", { name: "All", exact: true }).click();
    await search(page, l01.Name);
    await expect(rows(page, l01.Name)).toHaveCount(0);
    await expectWords(page);
  });

  await test.step("her report drill ends with '... no longer in your view'", async () => {
    await page.goto("reports/sales/team");
    await page.waitForLoadState("networkidle");
    if (await page.getByText("You don't have access to this page").isVisible()) {
      // TestCRM's Sales Executive role has no sales_reports grant (ledger T28 note).
      test.info().annotations.push({ type: "not-checked", description: "Sales Executive has no sales_reports View on TestCRM" });
      return;
    }
    const kasakId = await userId(request, "kasak", "kasak");
    await page.goto(`reports/sales/team/rows?metric=call&person=${kasakId}`);
    await expect(page.getByTestId("sales-rows-hidden")).toContainText("no longer in your view");
    await expectWords(page);
  });

  await test.step("reassigning a lost lead: 'Only a manager can reassign a closed record'", async () => {
    const l02 = await lead(request, "L02");
    await page.goto("sales/leads");
    await page.getByTestId("lead-presets").getByRole("tab", { name: "Lost", exact: true }).click();
    await search(page, l02.Name);
    await rows(page, l02.Name).getByRole("checkbox").check();
    await page.getByTestId("bulk-reassign-btn").click();
    await pick(page, "reassign-person", /AM Roshan/);
    await reasonAndRemarks(page, "reassign", "AM e2e: moving a result");
    await page.getByTestId("reassign-submit").click();
    await expect(snackbar(page, "Only a manager can reassign a closed record")).toBeVisible();
    await expect(page.getByTestId("reassign-lead-modal")).toBeVisible(); // 403 stays, with the server's words
  });

  await test.step("roshan: the lead and its quotation are there, 'Send back to Kasak' offered", async () => {
    const ctx = await browser.newContext({ storageState: authFile("roshan") });
    const roshan = await ctx.newPage();
    await expectSignedIn(roshan, "roshan");
    await roshan.goto(`sales/leads/${l01.Id}`);
    await expect(roshan.getByTestId("lead-detail")).toBeVisible();
    await expect(roshan.getByTestId("send-back-btn")).toHaveText("Send back to AM Kasak");
    await expectWords(roshan);
    await roshan.getByTestId("lead-detail-tabs").getByRole("tab", { name: /Quotations/ }).click();
    await expect(roshan.getByTestId(`quotation-${quotationId}`)).toBeVisible();
    await expectWords(roshan);
    await ctx.close();
  });
});
