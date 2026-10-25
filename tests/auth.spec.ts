import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resetLocalFixture } from "./fixture.ts";

test.beforeEach(() => resetLocalFixture());

function totp(secret: string, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase()]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const digest = createHmac("sha1", key).update(counter).digest();
  const position = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(position) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

test("production authentication lifecycle and security boundaries", async ({ page, request }) => {
  page.on("pageerror", (error) => console.log("Browser error:", error.message));
  page.on("response", (response) => {
    if (response.url().includes("/two-factor/")) {
      console.log("Factor response:", new URL(response.url()).pathname, response.status());
    }
  });
  const observations: Record<string, unknown> = {};
  const requests: {
    path: string;
    status: number;
    durationMs: number;
    at: string;
  }[] = [];
  observations.requests = requests;
  const credentials = {
    email: "analyst@cirque.test",
    password: "local-test-only-passphrase",
  };
  const origin = `http://127.0.0.1:${process.env.TEST_PORT ?? 3000}`;
  const post = async (path: string, data: object | (() => object), requestOrigin = origin) => {
    if (path.startsWith("/two-factor/")) await new Promise((resolve) => setTimeout(resolve, 10100));
    const started = performance.now();
    const response = await page.request.post(`/api/auth${path}`, {
      data: typeof data === "function" ? data() : data,
      headers: { Origin: requestOrigin },
    });
    requests.push({
      path,
      status: response.status(),
      durationMs: performance.now() - started,
      at: new Date().toISOString(),
    });
    expect(response.status(), "Behavior test must not be masked by rate limiting").not.toBe(429);
    return response;
  };
  const direct = await request.get("/dashboard", { maxRedirects: 0 });
  expect(direct.status()).toBe(303);
  expect(direct.headers().location).toBe("/login");
  for (const path of [
    "/incidents",
    "/incidents/INC-104",
    "/incidents/INC-104/report",
    "/projects",
    "/team",
  ]) {
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(303);
  }
  await request.post("/incidents/INC-104", {
    form: { note: "Anonymous users must not write notes." },
    headers: { Origin: origin },
    maxRedirects: 0,
  });
  const anonymousDatabase = new Database(
    JSON.parse(readFileSync("data/test-run.json", "utf8")).database,
    {
      readonly: true,
    },
  );
  expect(
    (
      anonymousDatabase
        .prepare("SELECT COUNT(*) AS count FROM workspace_event WHERE body = ?")
        .get("Anonymous users must not write notes.") as { count: number }
    ).count,
  ).toBe(0);
  anonymousDatabase.close();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Your profile" }).click();
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Continue setup" }).click();
  await expect(page.getByRole("img", { name: "Cirque authenticator setup QR code" })).toBeVisible();
  const secret = await page.getByTestId("totp-secret").textContent();
  expect(secret).toBeTruthy();
  let session = await (await page.request.get("/api/auth/get-session")).json();
  expect(session.user.twoFactorEnabled).toBe(false);
  await page.getByLabel("Authentication code").fill(totp(secret!, -10));
  await page.getByRole("button", { name: "Confirm authenticator" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Authentication code").fill(totp(secret!));
  await page.getByRole("button", { name: "Confirm authenticator" }).click();
  await expect(page.getByRole("heading", { name: "Authenticator app" })).toBeVisible();
  const backup = await page.locator(".codes code").first().textContent();
  const database = new Database(JSON.parse(readFileSync("data/test-run.json", "utf8")).database, {
    readonly: true,
  });
  const stored = database.prepare("SELECT backupCodes FROM twoFactor").get() as {
    backupCodes: string;
  };
  expect(stored.backupCodes.includes(backup!)).toBe(false);
  expect(stored.backupCodes.startsWith("scrypt-v1:")).toBe(true);
  observations.backupStorage = {
    oneWaySalted: true,
    reversibleWithAuthSecret: false,
  };
  database.close();
  await page.getByRole("link", { name: "Return to overview" }).click();
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await expect(page.getByRole("menuitem", { name: "Authenticator: On" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(
    page.getByText("A code is required when you sign in on a new session."),
  ).toBeVisible();
  await page.goto("/incidents/INC-104");
  await expect(page.getByRole("heading", { name: "Delayed webhook delivery" })).toBeVisible();
  expect((await page.request.get("/incidents/INC-104/report")).status()).toBe(403);
  const note = "Confirmed queue depth is falling after the rollout pause.";
  await page.getByLabel("Note", { exact: true }).fill(note);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText(note)).toBeVisible();
  await page.reload();
  await expect(page.getByText(note)).toBeVisible();
  expect(
    (
      await page.request.post("/incidents/INC-104", {
        form: { note: "Foreign origin note should be rejected." },
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/projects/northstar")).status()).toBe(200);
  expect((await page.request.get("/team")).status()).toBe(200);
  await page.goto("/dashboard");
  await new Promise((resolve) => setTimeout(resolve, 10100));
  await page.screenshot({ path: "docs/private/dashboard.png", fullPage: true });
  const cookies = await page.context().cookies();
  const token = cookies.find((cookie) => cookie.name.endsWith("session_token"))!;
  expect(token.httpOnly).toBe(true);
  expect(token.sameSite).toBe("Lax");
  expect(token.domain).toBe("127.0.0.1");
  observations.cookies = cookies.map(({ name, httpOnly, secure, sameSite, domain, path }) => ({
    name,
    httpOnly,
    secure,
    sameSite,
    domain,
    path,
  }));
  expect((await post("/sign-out", {}, "https://untrusted.example")).status()).toBe(403);
  expect(
    (
      await page.request.post("/api/auth/sign-out", {
        form: {},
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
  expect((await post("/sign-in/email", credentials, "https://untrusted.example")).status()).toBe(
    403,
  );
  expect((await page.request.get("/dashboard", { maxRedirects: 0 })).status()).toBe(200);
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  expect(
    (
      await request.get("/dashboard", {
        headers: { Cookie: `${token.name}=${token.value}` },
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(303);
  const login = await post("/sign-in/email", credentials);
  expect((await login.json()).twoFactorRedirect).toBe(true);
  session = await (await page.request.get("/api/auth/get-session")).json();
  expect(session).toBeNull();
  expect((await page.request.get("/dashboard", { maxRedirects: 0 })).status()).toBe(303);
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");
  expect(
    (
      await post("/two-factor/verify-totp", () => {
        const accepted = [-1, 0, 1].map((offset) => totp(secret!, offset));
        let candidate = 0;
        while (accepted.includes(candidate.toString().padStart(6, "0"))) candidate++;
        return { code: candidate.toString().padStart(6, "0") };
      })
    ).status(),
  ).toBe(401);
  expect((await post("/two-factor/verify-totp", { code: totp(secret!, -10) })).ok()).toBe(false);
  expect(
    (
      await post("/two-factor/verify-totp", {
        code: totp(secret!),
        trustDevice: true,
      })
    ).status(),
  ).toBe(400);
  await page.goto("/verify");
  await page.getByLabel("Authentication code").fill(totp(secret!));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL("/dashboard");
  for (const offset of [-2, 2]) {
    const response = await post("/two-factor/verify-totp", () => ({
      code: totp(secret!, offset),
    }));
    observations[`window_${offset}`] = {
      status: response.status(),
      at: new Date().toISOString(),
    };
    expect(response.ok()).toBe(false);
  }
  await post("/sign-out", {});
  await post("/sign-in/email", credentials);
  await new Promise((resolve) => setTimeout(resolve, 10100));
  await page.goto("/verify");
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await page.getByLabel("Recovery code").fill(backup!);
  await page.getByRole("button", { name: "Use recovery code" }).click();
  await expect(page).toHaveURL("/dashboard");
  await post("/sign-out", {});
  await post("/sign-in/email", credentials);
  expect((await post("/two-factor/verify-backup-code", { code: backup })).ok()).toBe(false);
  expect((await page.request.get("/dashboard", { maxRedirects: 0 })).status()).toBe(303);
  expect(
    (
      await post("/sign-up/email", {
        ...credentials,
        email: "other@cirque.test",
        name: "Other",
      })
    ).ok(),
  ).toBe(false);
  writeFileSync("docs/private/auth-observations.json", JSON.stringify(observations, null, 2));
});

test("MFA-pending client-side navigation cannot open dashboard", async ({ page }) => {
  await page.waitForTimeout(10100);
  const headers = {
    Origin: `http://127.0.0.1:${process.env.TEST_PORT ?? 3000}`,
  };
  const credentials = {
    email: "analyst@cirque.test",
    password: "local-test-only-passphrase",
  };
  const login = await page.request.post("/api/auth/sign-in/email", {
    data: credentials,
    headers,
  });
  const result = await login.json();
  if (!result.twoFactorRedirect) {
    const enrollment = await page.request.post("/api/auth/two-factor/enable", {
      data: { password: credentials.password },
      headers,
    });
    expect(enrollment.ok()).toBe(true);
    const secret = new URL((await enrollment.json()).totpURI).searchParams.get("secret")!;
    expect(
      (
        await page.request.post("/api/auth/two-factor/verify-totp", {
          data: { code: totp(secret) },
          headers,
        })
      ).ok(),
    ).toBe(true);
    await page.request.post("/api/auth/sign-out", { data: {}, headers });
    const pending = await page.request.post("/api/auth/sign-in/email", {
      data: credentials,
      headers,
    });
    expect((await pending.json()).twoFactorRedirect).toBe(true);
  }
  await page.goto("/verify");
  for (const path of [
    "/dashboard",
    "/incidents",
    "/incidents/INC-104",
    "/incidents/INC-104/report",
    "/projects",
    "/team",
  ]) {
    expect((await page.request.get(path, { maxRedirects: 0 })).status()).toBe(303);
  }
  await page.request.post("/incidents/INC-104", {
    form: { note: "Pending session must not write notes." },
    headers,
    maxRedirects: 0,
  });
  const database = new Database(JSON.parse(readFileSync("data/test-run.json", "utf8")).database, {
    readonly: true,
  });
  expect(
    (
      database
        .prepare("SELECT COUNT(*) AS count FROM workspace_event WHERE body = ?")
        .get("Pending session must not write notes.") as { count: number }
    ).count,
  ).toBe(0);
  database.close();
  await page.getByRole("link", { name: /cirque/ }).click();
  await expect(page).toHaveURL("/login");
  expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
});

test("response lead can read restricted report", async ({ page }) => {
  await page.waitForTimeout(10100);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("lead@cirque.test");
  await page.getByLabel("Password", { exact: true }).fill("local-test-only-passphrase");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/incidents/INC-104/report");
  await expect(page).toHaveURL(/\/profile\?setup=required$/);
  await expect(page.getByText(/A response lead needs an authenticator/)).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("local-test-only-passphrase");
  await page.getByRole("button", { name: "Continue setup" }).click();
  const secret = await page.getByTestId("totp-secret").textContent();
  await page.getByLabel("Authentication code").fill(totp(secret!));
  await page.getByRole("button", { name: "Confirm authenticator" }).click();
  await expect(page.getByRole("heading", { name: "Authenticator app" })).toBeVisible();
  await page.goto("/incidents/INC-104/report");
  await expect(page.getByRole("heading", { name: "Response lead report" })).toBeVisible();
  await expect(page.getByText("Customer identifiers and exact tenant impact")).toBeVisible();
});
