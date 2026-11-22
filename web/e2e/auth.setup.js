// e2e/auth.setup.js — signs each persona in through the real sign-in screen
// and saves its storage state to e2e/.auth/<persona>.json (git-ignored).
// PERSONA=<name> limits it to one. The target is checked after the company
// code step and BEFORE the password is typed (personas.checkTarget).
import { test as setup, expect } from "@playwright/test";
import { PERSONAS, COMPANY_CODE, WEB_URL, authFile, checkTarget, livePassword } from "./personas.js";

const only = process.env.PERSONA;
const list = only ? PERSONAS.filter((p) => p === only) : PERSONAS;
if (only && list.length === 0) throw new Error(`Unknown PERSONA=${only}; one of ${PERSONAS.join(", ")}`);

for (const persona of list) {
  setup(`sign in am_${persona}`, async ({ page }) => {
    checkTarget(WEB_URL, "http://localhost:5001"); // web origin first, before any page loads
    await page.goto("login");
    const code = page.locator("input[name=compCode]");
    await code.or(page.locator("input[name=password]")).first().waitFor();
    if (await code.isVisible()) {
      await code.fill(COMPANY_CODE);
      await page.getByRole("button", { name: "Continue" }).click();
    }
    await expect(page.locator("input[name=password]")).toBeVisible();
    const apiBase = await page.evaluate(() => JSON.parse(localStorage.getItem("auth-storage-eCRM") ?? "{}")?.state?.API_BASE_URL);
    checkTarget(page.url(), apiBase); // throws: no password is typed for a wrong target

    await page.locator("input[name=identifier]").fill(`am_${persona}`);
    await page.locator("input[name=password]").fill(livePassword());
    await page.getByRole("button", { name: /^Sign in/ }).click();
    await expect(page).not.toHaveURL(/\/login/);
    // First sign-in after go-live shows a one-off notice; acknowledge it.
    const notice = page.getByTestId("presence-notice");
    if (await notice.waitFor({ timeout: 3000 }).then(() => true, () => false)) await page.getByRole("button", { name: "OK" }).click();
    await page.context().storageState({ path: authFile(persona) });
  });
}
