import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { resetLocalFixture } from "./fixture.ts";

test.beforeEach(() => resetLocalFixture());

test("Cirque layouts stay usable across target widths", async ({ page }) => {
  const widths = [375, 768, 1280, 1920];
  const folder = "docs/private/cirque-screenshots";
  mkdirSync(folder, { recursive: true });
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(`http://127.0.0.1:${process.env.TEST_PORT ?? 3000}/`)) {
      externalRequests.push(request.url());
    }
  });
  const capture = async (name: string, width: number) => {
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `${folder}/${name}-${width}.png`,
      fullPage: true,
    });
  };
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await capture("login", width);
    await page.goto("/forgot-password");
    await capture("forgot-password", width);
  }
  await page.getByLabel("Email").fill("lead@cirque.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await capture("reset-requested", 1920);
  const { mailDirectory } = JSON.parse(readFileSync("data/test-run.json", "utf8")) as {
    mailDirectory: string;
  };
  const mailbox = createHash("sha256").update("lead@cirque.test").digest("hex") + ".json";
  const message = JSON.parse(readFileSync(join(mailDirectory, mailbox), "utf8")) as {
    text: string;
  };
  const link = message.text.match(/http:\/\/127\.0\.0\.1:\d+\/reset-password\/\S+/)![0];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(link);
    await capture("reset-password", width);
  }
  await page.goto("/reset-password/invalid");
  await capture("reset-unavailable", 1920);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("lead@cirque.test");
  await page.getByLabel("Password", { exact: true }).fill("local-test-only-passphrase");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/dashboard");
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await capture("dashboard", width);
    await page.goto("/incidents/INC-104");
    await capture("incident", width);
    await page.goto("/profile");
    await capture("profile", width);
    if (width === 375) {
      const disclosure = page.getByText("Why is it called two-factor?");
      await disclosure.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Signing in checks two different things/)).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Signing in checks two different things/)).toBeHidden();
    }
  }
  await page.getByLabel("Password", { exact: true }).fill("local-test-only-passphrase");
  await page.getByRole("button", { name: "Continue setup" }).click();
  await expect(page.getByRole("img", { name: "Cirque authenticator setup QR code" })).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await capture("enrollment", width);
  }
  expect(externalRequests).toEqual([]);
});
