// admin (am_amit, Admin) — spec §4 (Can see / Can assign to), §7 rows 13 and 17
// and the realtime exit: Roles & Permissions headings and the other-office
// sentence, the stranded-work dialog, the Reports-to sentence, and a complaint
// leaving vinod's open screen when amit reassigns it.
//
// The stranded step changes the seeded "AM Central Desk" role and restores it
// from a snapshot taken through the API first (finally, even on failure).
import { test, expect } from "@playwright/test";
import {
  api, authFile, complaint, expectSignedIn, expectWords, pick, reasonAndRemarks, rows, search, snackbar, userId,
} from "../personas.js";

test.describe.configure({ mode: "serial" });

const labelOf = (page, testId) => page.getByTestId(testId).locator("xpath=ancestor::label[1]");
const firstArray = (data) => Object.values(data ?? {}).find(Array.isArray) ?? [];

test("amit: roles, stranded work, reports-to, and a realtime exit", async ({ page, browser, request }) => {
  const asAmit = api(request, "amit");

  await test.step("signed in", () => expectSignedIn(page, "amit"));

  await test.step("Roles & Permissions: 'Can see' and 'Can assign to'; Whole company shows the other-office sentence", async () => {
    await page.goto("groups");
    await expect(page.getByRole("heading", { name: "Roles & Permissions" })).toBeVisible();
    await page.locator("[data-testid^=group-item-]").filter({ hasText: "Support Agent" }).first().click();
    const head = page.locator("main thead").first();
    await expect(head).toContainText("Can see");
    await expect(head).toContainText("Can assign to");
    await expect(head).not.toContainText("Reach");
    await expect(page.getByTestId("cross-office-note")).toHaveCount(0);
    await pick(page, "assign-complaints", "Whole company");
    await expect(page.getByTestId("cross-office-note")).toContainText("This role can send a record to another office.");
    // Not saved: the next step reloads the page, dropping the edit.
  });

  await test.step("saving a role change that strands work shows the stranded dialog", async () => {
    const groups = firstArray((await asAmit("/api/user-groups/fetchUserGroups", {})).body?.data);
    const desk = groups.find((g) => (g.Name ?? g.GroupName) === "AM Central Desk");
    expect(desk, "seeded role AM Central Desk").toBeTruthy();
    const GroupId = desk.Id;
    const snap = (await asAmit("/api/user-groups/fetchGroupModules", { GroupId })).body?.data;
    expect(snap?.modules?.length, "role snapshot").toBeGreaterThan(0);

    // Imran (AM Central Desk) holds one open complaint of this run.
    const c17 = await complaint(request, "C17");
    const reasons = (await asAmit("/api/config/fetchLookups", { Kind: "transfer_reason" })).body?.data?.lookups ?? [];
    const moved = await asAmit("/api/tickets/transferTicket", {
      TicketId: c17.Id, ToUserId: await userId(request, "amit", "imran"),
      ReasonId: reasons.find((r) => r.Code !== "sent_back")?.Id, Remarks: "AM e2e: stranded-work setup",
    });
    expect(moved.status, moved.body?.message).toBe(200);

    try {
      await page.goto("groups");
      await page.getByTestId(`group-item-${GroupId}`).click();
      await expect(page.getByTestId("perm-complaints-CanView")).toBeChecked();
      await labelOf(page, "perm-complaints-CanView").click();
      await expect(page.getByTestId("perm-complaints-CanView")).not.toBeChecked();
      await page.getByTestId("save-permissions-btn").click();
      const dialog = page.getByTestId("stranded-dialog");
      await expect(dialog).toContainText("Open work left behind");
      await expect(dialog).toContainText(/\d+ open complaints? (is|are) still assigned to AM Imran/);
      await dialog.getByRole("button", { name: "OK" }).click();
    } finally {
      const restored = await asAmit("/api/user-groups/saveGroupModules", {
        GroupId,
        Modules: snap.modules.map(({ Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach }) => ({
          Module, CanView: !!CanView, CanAdd: !!CanAdd, CanEdit: !!CanEdit, CanDelete: !!CanDelete, Reach, AssignReach,
        })),
        CanSeeSensitive: !!snap.canSeeSensitive,
      });
      expect(restored.status, `restore AM Central Desk: ${restored.body?.message}`).toBe(200);
    }
  });

  await test.step("user form shows the Reports-to sentence", async () => {
    await page.goto("users");
    await search(page, "AM Vinod");
    await rows(page, "AM Vinod").first().getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Their manager, and that manager's managers, can see the leads and complaints this person holds")).toBeVisible();
  });

  await test.step("realtime: amit reassigns C15 while vinod has it open; vinod's page leaves within 5 s", async () => {
    const c15 = await complaint(request, "C15");
    const ctx = await browser.newContext({ storageState: authFile("vinod") });
    const vinod = await ctx.newPage();
    try {
      await expectSignedIn(vinod, "vinod");
      await vinod.goto(`support/tickets/${c15.Id}`);
      await expect(vinod.getByTestId("ticket-detail")).toBeVisible();
      await vinod.waitForLoadState("networkidle"); // socket connected

      await page.goto(`support/tickets/${c15.Id}`);
      await expect(page.getByTestId("ticket-detail")).toBeVisible();
      await expectWords(page);
      await page.getByTestId("reassign-ticket-btn").click();
      await pick(page, "ticket-reassign-person", /AM Vivek/);
      await reasonAndRemarks(page, "ticket-reassign", "AM e2e: realtime");
      await page.getByTestId("ticket-reassign-submit").click();
      await expect(snackbar(page, "Reassigned to AM Vivek")).toBeVisible();

      // No reload on vinod's side: the push refetches, the 404 sends him to the list.
      await expect(vinod).toHaveURL(/\/support\/tickets$/, { timeout: 5000 });
      await expect(snackbar(vinod, "This record is no longer with you")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
