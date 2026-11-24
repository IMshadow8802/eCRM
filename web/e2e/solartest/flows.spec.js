// SolarTest flows (a–e): real SolarCRM people on the private copy, through the
// real screens. Records this run creates carry "SOLARTEST" in subject/remarks.
import { test, expect } from "@playwright/test";
import { P, api, pick, reasonAndRemarks, rows, search, signIn, snackbar } from "./solartest.js";

test.describe.configure({ mode: "serial" });

const STAMP = `SOLARTEST ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
const NOT_WITH_YOU = "This record is no longer with you";

/** 143: the reason list never offers "Sent back" (only the Send back button writes it). */
async function noSentBack(page, prefix) {
  await page.getByTestId(`${prefix}-reason-input`).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(page.getByRole("option", { name: /Sent back/i })).toHaveCount(0);
  await page.keyboard.press("Escape");
}

/** Titles of the sidebar entries the person sees. */
const sidebar = async (page) => {
  await page.locator("[data-testid^=sidebar-]").first().waitFor();
  return (await page.locator("[data-testid^=sidebar-]").evaluateAll((els) => els.map((e) => e.dataset.testid)))
    .map((t) => t.replace(/^sidebar-/, ""));
};

test("a. Neha hands Kasak's lead to Roshan; Kasak loses it; Neha hands it back", async ({ browser }) => {
  const lead = (await api("kasak", "/api/leads/fetchLeads", { PageNumber: 1, PageSize: 1 })).body.data.leads[0];
  expect(lead.OwnerId ?? lead.AssignedTo).toBeTruthy();

  const neha = await signIn(browser, "neha");
  await test.step("Neha: leads list loads; its pages match her total", async () => {
    // The table shows no total, only page buttons (see report): check those against the API total.
    const total = (await api("neha", "/api/leads/fetchLeads", { PageNumber: 1, PageSize: 25 })).body.data.pagination.totalRecords;
    await neha.page.goto("sales/leads");
    await expect(neha.page.locator("main tbody tr").first()).toBeVisible();
    const pages = Math.ceil(total / 25);
    await expect(neha.page.getByRole("button", { name: `Go to page ${pages}`, exact: true })).toBeVisible();
    await expect(neha.page.getByRole("button", { name: `Go to page ${pages + 1}`, exact: true })).toHaveCount(0);
    await expect(neha.page.getByTestId("leads-total")).toHaveText(`${total} lead${total === 1 ? "" : "s"}`); // 143
  });
  await test.step("Neha opens the lead and reassigns it to Roshan", async () => {
    await search(neha.page, lead.Name);
    await neha.page.getByTestId(`view-lead-${lead.Id}`).click();
    await expect(neha.page.getByTestId("lead-detail")).toBeVisible();
    await neha.page.getByTestId("reassign-lead-btn").click();
    await pick(neha.page, "reassign-person", /Roshan/);
    await noSentBack(neha.page, "reassign");
    await reasonAndRemarks(neha.page, "reassign", `${STAMP} handover`);
    await neha.page.getByTestId("reassign-submit").click();
    await expect(snackbar(neha.page, "Reassigned to Roshan")).toBeVisible();
  });

  const kasak = await signIn(browser, "kasak");
  await test.step("Kasak: search finds no such row, its URL says not with you", async () => {
    await kasak.page.goto("sales/leads");
    await search(kasak.page, lead.Name);
    await expect(kasak.page.getByTestId(`view-lead-${lead.Id}`)).toHaveCount(0);
    await kasak.page.goto(`sales/leads/${lead.Id}`);
    await expect(kasak.page).toHaveURL(/\/sales\/leads$/);
    await expect(snackbar(kasak.page, NOT_WITH_YOU)).toBeVisible();
  });

  await test.step("Neha hands it back to Kasak", async () => {
    await neha.page.goto(`sales/leads/${lead.Id}`);
    await expect(neha.page.getByTestId("lead-detail")).toBeVisible();
    await neha.page.getByTestId("reassign-lead-btn").click();
    await pick(neha.page, "reassign-person", /Kasak/);
    await reasonAndRemarks(neha.page, "reassign", `${STAMP} back`);
    await neha.page.getByTestId("reassign-submit").click();
    await expect(snackbar(neha.page, "Reassigned to Kasak")).toBeVisible();
  });
  await test.step("Kasak has it again", async () => {
    await kasak.page.goto(`sales/leads/${lead.Id}`);
    await expect(kasak.page.getByTestId("lead-detail")).toBeVisible();
  });
  await neha.ctx.close();
  await kasak.ctx.close();
});

test("b. complaint: desk → Vinod → back → Vivek → escalate Rohit → Vinod → resolve → Neha reopens", async ({ browser }) => {
  const t60 = (await api("amit", "/api/tickets/fetchTicketDetail", { TicketId: 60 })).body.data.ticket;
  const subject = `${STAMP} complaint`;
  let id;
  const open = async (page) => {
    await page.goto(`support/tickets/${id}`);
    await expect(page.getByTestId("ticket-detail")).toBeVisible();
  };

  const nitin = await signIn(browser, "nitin");
  await test.step("Nitin logs it for an existing customer, assigned to Vinod", async () => {
    await nitin.page.goto("support/tickets");
    await nitin.page.getByTestId("new-ticket-btn").click();
    await nitin.page.getByTestId("customer-picker-input").fill(t60.CustomerName);
    await nitin.page.getByRole("option", { name: new RegExp(t60.CustomerName, "i") }).first().click();
    await nitin.page.getByTestId("ticket-subject").fill(subject);
    await pick(nitin.page, "ticket-assignee", /Vinod/);
    await nitin.page.getByTestId("create-ticket-submit").click();
    await expect(snackbar(nitin.page, "Logged and assigned to Vinod")).toBeVisible();
    const r = await api("amit", "/api/tickets/fetchTickets", { SearchTerm: subject, PageSize: 5 });
    id = (r.body?.data?.tickets ?? []).find((t) => t.Subject === subject)?.Id;
    expect(id, "the new complaint exists").toBeTruthy();
  });

  const vinod = await signIn(browser, "vinod");
  await test.step("Vinod sees it in his list and sends it back", async () => {
    await vinod.page.goto("support/tickets");
    await expect(vinod.page.getByTestId("tickets-total")).toHaveText(/^\d+ complaints?$/); // 143
    await search(vinod.page, subject);
    await expect(rows(vinod.page, subject)).toHaveCount(1);
    await open(vinod.page);
    await vinod.page.getByTestId("send-back-ticket-btn").click();
    await vinod.page.getByTestId("remarks-input").fill(`${STAMP} not mine`);
    await vinod.page.getByTestId("remarks-submit").click();
    await expect(snackbar(vinod.page, /Sent back to Nitin/)).toBeVisible();
  });

  await test.step("Nitin reassigns to Vivek", async () => {
    await open(nitin.page);
    await nitin.page.getByTestId("reassign-ticket-btn").click();
    await pick(nitin.page, "ticket-reassign-person", /Vivek/);
    await noSentBack(nitin.page, "ticket-reassign");
    await reasonAndRemarks(nitin.page, "ticket-reassign", `${STAMP} route`);
    await nitin.page.getByTestId("ticket-reassign-submit").click();
    await expect(snackbar(nitin.page, "Reassigned to Vivek")).toBeVisible();
  });

  const vivek = await signIn(browser, "vivek");
  await test.step("Vivek escalates to Rohit", async () => {
    await open(vivek.page);
    await vivek.page.getByTestId("escalate-ticket-btn").click();
    await pick(vivek.page, "escalate-target", /ROHIT/i);
    await vivek.page.getByTestId("escalate-remarks").fill(`${STAMP} need senior`);
    await vivek.page.getByTestId("escalate-submit").click();
    await expect(vivek.page.getByTestId("ticket-escalated-chip")).toContainText(/ROHIT/i);
  });

  const rohit = await signIn(browser, "rohit");
  await test.step("Rohit opens it and reassigns to Vinod", async () => {
    await open(rohit.page);
    await expect(rohit.page.getByTestId("ticket-escalated-chip")).toContainText(/ROHIT/i);
    await rohit.page.getByTestId("reassign-ticket-btn").click();
    await pick(rohit.page, "ticket-reassign-person", /Vinod/);
    await reasonAndRemarks(rohit.page, "ticket-reassign", `${STAMP} you take it`);
    await rohit.page.getByTestId("ticket-reassign-submit").click();
    await expect(snackbar(rohit.page, "Reassigned to Vinod")).toBeVisible();
  });

  await test.step("Vinod resolves; then no Reopen for him", async () => {
    await open(vinod.page);
    await vinod.page.getByTestId("resolve-ticket-btn").click();
    await vinod.page.getByTestId("resolution-combobox-input").click();
    await vinod.page.getByRole("option").first().click();
    await vinod.page.getByTestId("resolve-remarks").fill(`${STAMP} fixed`);
    await vinod.page.getByTestId("resolve-submit").click();
    await expect(vinod.page.getByTestId("resolve-ticket-modal")).toHaveCount(0);
    await vinod.page.reload();
    await expect(vinod.page.getByTestId("ticket-detail")).toBeVisible();
    await expect(vinod.page.getByTestId("ticket-status-chip")).toBeVisible();
    await expect(vinod.page.getByTestId("reopen-ticket-btn")).toHaveCount(0);
  });

  const neha = await signIn(browser, "neha");
  await test.step("Neha reopens", async () => {
    await open(neha.page);
    await neha.page.getByTestId("reopen-ticket-btn").click();
    await neha.page.getByTestId("remarks-input").fill(`${STAMP} not fixed`);
    await neha.page.getByTestId("remarks-submit").click();
    await expect(neha.page.getByTestId("reopen-ticket-btn")).toHaveCount(0);
    await expect(neha.page.getByTestId("resolve-ticket-btn")).toBeVisible();
  });
  for (const s of [nitin, vinod, vivek, rohit, neha]) await s.ctx.close();
});

test("c. Kasak cannot open Roshan's lead; Nitin has no Leads; Kasak has no Complaints", async ({ browser }) => {
  const rl = (await api("roshan", "/api/leads/fetchLeads", { PageNumber: 1, PageSize: 1 })).body.data.leads[0];
  const kasak = await signIn(browser, "kasak");
  await kasak.page.goto(`sales/leads/${rl.Id}`);
  await expect(kasak.page).toHaveURL(/\/sales\/leads$/);
  await expect(snackbar(kasak.page, NOT_WITH_YOU)).toBeVisible();
  const kMenu = await sidebar(kasak.page);
  test.info().annotations.push({ type: "kasak sidebar", description: kMenu.join(", ") });
  expect(kMenu.some((t) => /complaint|support/i.test(t))).toBe(false);
  await kasak.page.goto("support/tickets");
  await expect(kasak.page.getByTestId("ticket-detail").or(kasak.page.getByTestId("new-ticket-btn"))).toHaveCount(0);
  await kasak.ctx.close();

  const nitin = await signIn(browser, "nitin");
  const nMenu = await sidebar(nitin.page);
  test.info().annotations.push({ type: "nitin sidebar", description: nMenu.join(", ") });
  expect(nMenu.some((t) => /lead|sales/i.test(t))).toBe(false);
  await nitin.ctx.close();
});

test("d. Amit: dashboard and the sales Team report load", async ({ browser }) => {
  const amit = await signIn(browser, "amit");
  const errors = [];
  amit.page.on("response", (r) => { if (r.url().startsWith("http://localhost:5001/api/") && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await amit.page.goto("./");
  await amit.page.waitForLoadState("networkidle");
  await expect(amit.page.locator("main")).not.toContainText(/something went wrong/i);
  await amit.page.goto("reports/sales/team");
  await expect(amit.page.getByTestId("sales-team-table")).toBeVisible();
  await expect(amit.page.getByTestId("sales-team-table")).toContainText("Neha Yadav"); // tele-callers roll up under her
  // 143: support staff (no leads view, no sales history) are not report rows.
  for (const n of ["Nitin Kumar", "Prasant", "ROHIT GAUR", "Vinod Kumar", "Vivek Kumar"]) {
    await expect(amit.page.getByTestId("sales-team-table")).not.toContainText(n);
  }
  expect(errors).toEqual([]);
  await amit.ctx.close();
});

test("e. Nitin's complaint assignee picker lists support people; search by name works", async ({ browser }) => {
  const nitin = await signIn(browser, "nitin");
  await nitin.page.goto("support/tickets");
  await nitin.page.getByTestId("new-ticket-btn").click();
  const input = nitin.page.getByTestId("ticket-assignee-input");
  await input.click();
  const options = nitin.page.getByRole("option");
  for (const n of [/Vinod/, /Vivek/, /ROHIT/i, /Prasant/]) await expect(options.filter({ hasText: n }).first()).toBeVisible();
  await expect(options.filter({ hasText: /Kasak|Roshan/ })).toHaveCount(0);
  await input.fill("Viv");
  await expect(options.filter({ hasText: /Vivek/ })).toHaveCount(1);
  await expect(options.filter({ hasText: /Vinod/ })).toHaveCount(0);
  await nitin.ctx.close();
});

test("f. TKT-000002's history reads 'Reassigned to', never 'Transferred to' (143)", async ({ browser }) => {
  const vinod = await signIn(browser, "vinod");
  await vinod.page.goto("support/tickets/60");
  const detail = vinod.page.getByTestId("ticket-detail");
  await expect(detail).toBeVisible();
  await detail.getByRole("tab", { name: /Timeline/ }).click();
  await expect(detail).toContainText("Reassigned to");
  await expect(detail).not.toContainText("Transferred to");
  await vinod.ctx.close();
});
