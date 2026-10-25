import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resetLocalFixture } from "./fixture.ts";

test.beforeEach(() => resetLocalFixture());

test("workspace shell, menu, filters, note feedback, and responsive captures", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  const heroHeading = page.getByRole("heading", { name: "Stay close to what matters." });
  const heroTypography = await heroHeading.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) };
  });
  expect(heroTypography.lineHeight).toBeGreaterThan(heroTypography.fontSize);
  await page.getByLabel("Email", { exact: true }).fill("analyst@cirque.test");
  await page.getByLabel("Password", { exact: true }).fill("local-test-only-passphrase");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/dashboard");

  const trigger = page.getByRole("button", { name: /Account menu for/ });
  await expect(page.getByRole("link", { name: "Incidents 2" })).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Authenticator: Off" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Authenticator: Off" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("menu")).toBeHidden();
  await trigger.click();
  await page.getByRole("heading", { name: "Overview" }).click();
  await expect(page.getByRole("menu")).toBeHidden();

  const folder = "docs/private/cirque-ui-after";
  mkdirSync(folder, { recursive: true });
  const views = [
    ["overview", "/dashboard"],
    ["incidents", "/incidents"],
    ["incident-detail", "/incidents/INC-104"],
    ["projects", "/projects"],
    ["team", "/team"],
    ["authenticator", "/profile"],
  ] as const;
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    let anchor: { x: number; y: number } | undefined;
    for (const [name, route] of views) {
      await page.goto(route);
      await expect(page.locator(".workspace-main")).toBeVisible();
      const bounds = await trigger.boundingBox();
      expect(bounds).not.toBeNull();
      if (anchor) {
        expect(Math.abs(bounds!.x - anchor.x)).toBeLessThan(1);
        expect(Math.abs(bounds!.y - anchor.y)).toBeLessThan(1);
      }
      anchor = { x: bounds!.x, y: bounds!.y };
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: `${folder}/${name}-${width}.png` });
      await page.locator(".workspace-main").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      if (["overview", "incident-detail", "authenticator"].includes(name)) {
        expect(
          await page.locator(".workspace-main").evaluate((element) => element.scrollTop),
        ).toBeGreaterThan(0);
      }
      const scrolled = await trigger.boundingBox();
      expect(Math.abs(scrolled!.x - anchor.x)).toBeLessThan(1);
      expect(Math.abs(scrolled!.y - anchor.y)).toBeLessThan(1);
      await page.screenshot({ path: `${folder}/${name}-${width}-scrolled.png` });
    }
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/incidents");
  await expect(page.locator(".incident-table tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "Resolved 1" }).click();
  await expect(page.locator(".incident-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "All 3" }).click();
  await page.getByRole("button", { name: "Mine" }).click();
  await expect(page.locator(".incident-table tbody tr")).toHaveCount(1);

  await page.goto("/incidents/INC-104");
  await page
    .getByLabel("Note", { exact: true })
    .fill("Queue depth is improving after the rollout pause.");
  await page.getByLabel("Note", { exact: true }).press("Control+Enter");
  await expect(page.getByRole("status").filter({ hasText: "Note saved" })).toBeVisible();
  await expect(page.locator(".timeline-item").first()).toContainText("Queue depth is improving");
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue("");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.locator("#workspace-sidebar")).toHaveClass(/open/);
  await page
    .getByRole("button", { name: "Close navigation" })
    .click({ position: { x: 350, y: 200 } });
  await expect(page.locator("#workspace-sidebar")).not.toHaveClass(/open/);

  await page.goto("/profile");
  const questions = page.locator(".auth-questions details");
  await expect(questions).toHaveCount(4);
  for (const question of await questions.all()) await expect(question).not.toHaveAttribute("open");
});
