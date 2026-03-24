import { test, expect } from "@playwright/test";

test.describe("Tinfoil E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for React hydration
    await page.waitForSelector(".crt-frame");
  });

  // ─── UI RENDERING ───

  test("page loads with CRT frame and all structural elements", async ({ page }) => {
    await expect(page.locator(".crt-frame")).toBeVisible();
    await expect(page.locator("header")).toContainText("Project:");
    await expect(page.locator(".stamp-large")).toContainText("CLASSIFIED");
    await expect(page.getByText("HACKATHON 20XX")).toBeVisible();
    await expect(page.locator("header .redacted")).toBeVisible();
    await expect(page.getByText("INTELLIGENCE PIPELINE READY")).toBeVisible();
    await expect(page.getByText("Key Evidence")).toBeVisible();
    await expect(page.getByText("Intel Feed / Anomaly Reports")).toBeVisible();
    await expect(page.getByText("Operations")).toBeVisible();
    await expect(page.getByText("TINFOIL v0.2")).toBeVisible();
    await expect(page.getByText("@debgotwired")).toBeVisible();
    await expect(page.getByText("#ELEVENHACKS 2026")).toBeVisible();
  });

  test("input fields and placeholders render correctly", async ({ page }) => {
    const inputA = page.locator("#subject-a");
    const inputB = page.locator("#subject-b");
    await expect(inputA).toBeVisible();
    await expect(inputB).toBeVisible();
    const placeholderA = await inputA.getAttribute("placeholder");
    const placeholderB = await inputB.getAttribute("placeholder");
    expect(placeholderA).toBeTruthy();
    expect(placeholderB).toBeTruthy();
  });

  test("idle state shows correct intro text", async ({ page }) => {
    await expect(page.getByText("Enter two subjects.")).toBeVisible();
    await expect(page.getByText("THE INTERPRETATION IS OURS")).toBeVisible();
    await expect(page.getByText("Awaiting Input")).toBeVisible();
  });

  test("evidence board shows empty state", async ({ page }) => {
    await expect(page.getByText("0 documents pinned")).toBeVisible();
    await expect(page.getByText("Evidence will be")).toBeVisible();
  });

  test("telemetry panel shows idle stats", async ({ page }) => {
    await expect(page.getByText("TELEMETRY")).toBeVisible();
    await expect(page.getByText("IDLE")).toBeVisible();
    await expect(page.getByText("0 entries")).toBeVisible();
  });

  // ─── BUTTON STATE ───

  test("Connect the Dots button disabled without input", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Connect the Dots" });
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test("Connect the Dots button enabled with both inputs", async ({ page }) => {
    await page.locator("#subject-a").fill("cats");
    await page.locator("#subject-b").fill("pizza");
    const btn = page.getByRole("button", { name: "Connect the Dots" });
    await expect(btn).toBeEnabled();
  });

  test("Connect the Dots button disabled with only one input", async ({ page }) => {
    await page.locator("#subject-a").fill("cats");
    const btn = page.getByRole("button", { name: "Connect the Dots" });
    await expect(btn).toBeDisabled();
  });

  test("decorative buttons are disabled", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Decrypt Logs" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Archive Evidence" })).toBeDisabled();
  });

  // ─── KEYBOARD NAVIGATION ───

  test("Enter on Subject A focuses Subject B", async ({ page }) => {
    await page.locator("#subject-a").fill("cats");
    await page.locator("#subject-a").press("Enter");
    await expect(page.locator("#subject-b")).toBeFocused();
  });

  // ─── FULL FLOW (real APIs) ───

  test("full flow: research → generate → broadcast", async ({ page }) => {
    test.setTimeout(180_000); // 3 min for real API calls

    // Fill inputs
    await page.locator("#subject-a").fill("IKEA");
    await page.locator("#subject-b").fill("the Moon Landing");

    // Click Connect the Dots
    await page.getByRole("button", { name: "Connect the Dots" }).click();

    // Phase: RESEARCHING
    await expect(page.getByText("Scanning Frequencies")).toBeVisible({ timeout: 5_000 });
    // Inputs should be disabled
    await expect(page.locator("#subject-a")).toBeDisabled();
    await expect(page.locator("#subject-b")).toBeDisabled();

    // Wait for research to complete + generation to start
    await expect(page.getByText("SOURCES INDEXED")).toBeVisible({ timeout: 45_000 });

    // Phase: GENERATING — text should start streaming in
    await expect(page.getByText("Generating Intel", { exact: true })).toBeVisible({ timeout: 15_000 });

    // Wait for transcript entries to appear (real OpenAI streaming)
    await expect(page.locator(".intel-entry").first()).toBeVisible({ timeout: 45_000 });

    // Should have date stamp on first entry
    await expect(page.getByText(/DATE:.*202X/)).toBeVisible();

    // BROADCAST START marker
    await expect(page.getByText("BROADCAST START")).toBeVisible();

    // Evidence should start appearing on the cork board
    await expect(page.locator(".paper-card").first()).toBeVisible({ timeout: 45_000 });

    // Cited sources count should update from 0
    await expect(page.locator("text=/[1-9]\\d* documents? pinned/")).toBeVisible({ timeout: 45_000 });

    // Telemetry feed entries should update from 0
    const feedEntries = page.locator(".intel-entry");
    await expect(feedEntries.first()).toBeVisible();

    // Wait for generation to complete → broadcasting or done
    // Use button presence instead of status text (avoids strict mode issues)
    const cutSignal = page.getByRole("button", { name: "Cut Signal" });
    const newInvestigation = page.getByRole("button", { name: "New Investigation" });
    await expect(cutSignal.or(newInvestigation)).toBeVisible({ timeout: 90_000 });

    // End the broadcast (click Cut Signal if still broadcasting, or it's already done)
    if (await cutSignal.isVisible()) {
      await cutSignal.click();
    }

    // Phase: DONE
    await expect(newInvestigation).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("COMPLETE", { exact: true })).toBeVisible();

    // Click New Investigation — verify full reset
    await newInvestigation.click();
    await expect(page.getByText("Awaiting Input")).toBeVisible();
    await expect(page.getByText("IDLE")).toBeVisible();
    await expect(page.getByText("0 documents pinned")).toBeVisible();
    await expect(page.getByText("0 entries")).toBeVisible();
    await expect(page.locator("#subject-a")).toBeEnabled();
    await expect(page.locator("#subject-b")).toBeEnabled();
  });

  // ─── CSS / VISUAL ───

  test("CRT frame has proper styling", async ({ page }) => {
    const frame = page.locator(".crt-frame");
    const border = await frame.evaluate((el) => getComputedStyle(el).borderStyle);
    expect(border).toBe("solid");
  });

  test("beveled buttons have box-shadow", async ({ page }) => {
    await page.locator("#subject-a").fill("x");
    await page.locator("#subject-b").fill("y");
    const btn = page.getByRole("button", { name: "Connect the Dots" });
    const shadow = await btn.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
  });

  test("scanline effect present on intel feed", async ({ page }) => {
    await expect(page.locator(".scanline")).toBeVisible();
  });

  test("vignette effect present", async ({ page }) => {
    await expect(page.locator(".vignette")).toBeVisible();
  });

  // ─── ERROR HANDLING ───

  test("handles empty submit gracefully (no crash)", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Connect the Dots" });
    await expect(btn).toBeDisabled();
    // Force click bypassing disabled — should not crash the app
    await btn.click({ force: true });
    await expect(page.getByText("Enter two subjects.")).toBeVisible();
  });
});
