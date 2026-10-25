import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { unflatten } from "devalue";
import { resetLocalFixture } from "./fixture.ts";

test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 10500));
  resetLocalFixture();
});

const origin = `http://127.0.0.1:${process.env.TEST_PORT ?? 3000}`;
const headers = { Origin: origin };
const actionHeaders = { ...headers, "x-sveltekit-action": "true" };
const password = "local-test-only-passphrase";

function codeAt(secret: string, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const digest = createHmac("sha1", key).update(counter).digest();
  const position = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function enroll(page: import("@playwright/test").Page, email: string, signedIn = false) {
  if (!signedIn) {
    const signIn = await page.request.post("/api/auth/sign-in/email", {
      data: { email, password },
      headers,
    });
    expect(signIn.status()).toBe(200);
  }
  const enrollment = await page.request.post("/api/auth/two-factor/enable", {
    data: { password },
    headers,
  });
  expect(enrollment.status()).toBe(200);
  const { totpURI, backupCodes } = await enrollment.json();
  const secret = new URL(totpURI).searchParams.get("secret")!;
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-totp", {
        data: { code: codeAt(secret) },
        headers,
      })
    ).status(),
  ).toBe(200);
  return { secret, backupCodes: backupCodes as string[] };
}

async function prove(
  page: import("@playwright/test").Page,
  action: string,
  code: string,
  suppliedPassword = password,
) {
  return page.request.post("/profile?/proveMfa", {
    form: { action, password: suppliedPassword, code },
    headers: actionHeaders,
  });
}

function database() {
  const path = JSON.parse(readFileSync("data/test-run.json", "utf8")).database;
  return new Database(path);
}

async function actionData(response: import("@playwright/test").APIResponse) {
  const result = await response.json();
  return unflatten(JSON.parse(result.data)) as Record<string, unknown>;
}

test("direct Better Auth endpoints cannot bypass management proof", async ({ page }) => {
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        data: { email: "lead@cirque.test", password },
        headers,
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post("/api/auth/two-factor/enable", {
        data: { password, method: "otp" },
        headers,
      })
    ).status(),
  ).toBe(403);
  const { secret } = await enroll(page, "lead@cirque.test", true);
  expect((await page.request.get("/incidents/INC-104/report")).status()).toBe(200);
  for (const endpoint of [
    "disable",
    "generate-backup-codes",
    "get-totp-uri",
    "send-otp",
    "verify-otp",
  ]) {
    const response = await page.request.post(`/api/auth/two-factor/${endpoint}`, {
      data: { password, code: codeAt(secret, 1) },
      headers,
    });
    expect(response.status(), endpoint).toBe(403);
  }
  expect(
    (
      await page.request.post("/api/auth/two-factor/enable", { data: { password }, headers })
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/incidents/INC-104/report")).status()).toBe(200);
});

test("disable requires password and fresh factor, revokes factor and all sessions", async ({
  page,
  browser,
}) => {
  const { secret, backupCodes } = await enroll(page, "lead@cirque.test");
  const other = await browser.newContext();
  try {
    const signIn = await other.request.post("/api/auth/sign-in/email", {
      data: { email: "lead@cirque.test", password },
      headers,
    });
    expect((await signIn.json()).twoFactorRedirect).toBe(true);
    expect(
      (
        await other.request.post("/api/auth/two-factor/verify-backup-code", {
          data: { code: backupCodes[0] },
          headers,
        })
      ).status(),
    ).toBe(200);
    expect((await other.request.get("/incidents/INC-104/report")).status()).toBe(200);
    expect((await prove(page, "disable", codeAt(secret, 1), "wrong-password")).status()).toBe(400);
    expect((await prove(page, "disable", "000000")).status()).toBe(400);
    const proofResponse = await prove(page, "disable", codeAt(secret, 1));
    expect(proofResponse.status()).toBe(200);
    const proof = (await actionData(proofResponse)).proof as string | undefined;
    expect(proof).toBeTruthy();
    expect((await prove(page, "disable", codeAt(secret, 1))).status()).toBe(400);
    const wrongAction = await page.request.post("/profile?/beginReplacement", {
      form: { proof: proof! },
      headers: actionHeaders,
    });
    expect(wrongAction.status()).toBe(400);
    const results = await Promise.all(
      [0, 1].map(() =>
        page.request.post("/profile?/disableMfa", {
          form: { proof: proof! },
          headers: actionHeaders,
          maxRedirects: 0,
        }),
      ),
    );
    const outcomes = await Promise.all(results.map((result) => result.json()));
    expect(outcomes.filter((result) => result.location === "/login?mfa=disabled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.location === "/login")).toHaveLength(1);
    expect(
      (await other.request.get("/incidents/INC-104/report", { maxRedirects: 0 })).status(),
    ).toBe(303);
    const storage = database();
    const state = storage
      .prepare(
        "SELECT (SELECT COUNT(*) FROM twoFactor WHERE userId = user.id) AS factors, twoFactorEnabled AS enabled, (SELECT COUNT(*) FROM session WHERE userId = user.id) AS sessions FROM user WHERE email = ?",
      )
      .get("lead@cirque.test") as { factors: number; enabled: number; sessions: number };
    expect(state).toEqual({ factors: 0, enabled: 0, sessions: 0 });
    storage.close();
    expect(
      (
        await page.request.post("/api/auth/sign-in/email", {
          data: { email: "lead@cirque.test", password },
          headers,
        })
      ).status(),
    ).toBe(200);
    expect(
      (await page.request.get("/incidents/INC-104/report", { maxRedirects: 0 })).headers().location,
    ).toBe("/profile?setup=required");
  } finally {
    await other.close();
  }
});

test("replacement keeps old factor until confirmation then rotates factor, codes and sessions", async ({
  page,
}) => {
  const { secret, backupCodes } = await enroll(page, "analyst@cirque.test");
  const proofResponse = await prove(page, "replace", backupCodes[0]);
  expect(proofResponse.status()).toBe(200);
  const proof = (await actionData(proofResponse)).proof as string | undefined;
  expect(proof).toBeTruthy();
  const begin = await page.request.post("/profile?/beginReplacement", {
    form: { proof: proof! },
    headers: actionHeaders,
  });
  expect(begin.status()).toBe(200);
  const uri = (await actionData(begin)).replacementURI as string | undefined;
  expect(uri).toBeTruthy();
  const newSecret = new URL(uri!).searchParams.get("secret")!;
  expect(newSecret).not.toBe(secret);
  expect(
    (
      await page.request.post("/profile?/confirmReplacement", {
        form: { code: "000000" },
        headers: actionHeaders,
      })
    ).status(),
  ).toBe(400);
  expect((await page.request.get("/dashboard")).status()).toBe(200);
  const complete = await page.request.post("/profile?/confirmReplacement", {
    form: { code: codeAt(newSecret) },
    headers: actionHeaders,
  });
  expect(complete.status()).toBe(200);
  const recoveryCodes = (await actionData(complete)).recoveryCodes as string[] | undefined;
  expect(recoveryCodes).toBeTruthy();
  expect(recoveryCodes).toHaveLength(10);
  const storage = database();
  const factor = storage
    .prepare(
      "SELECT backupCodes FROM twoFactor WHERE userId = (SELECT id FROM user WHERE email = ?)",
    )
    .get("analyst@cirque.test") as { backupCodes: string };
  const sessions = storage
    .prepare(
      "SELECT COUNT(*) AS total FROM session WHERE userId = (SELECT id FROM user WHERE email = ?)",
    )
    .get("analyst@cirque.test") as { total: number };
  expect(sessions.total).toBe(0);
  expect(factor.backupCodes.startsWith("scrypt-v1:")).toBe(true);
  expect(factor.backupCodes).not.toContain(recoveryCodes![0]);
  expect(factor.backupCodes).not.toContain(backupCodes[1]);
  storage.close();
  expect((await page.request.get("/dashboard", { maxRedirects: 0 })).status()).toBe(303);
  const signIn = await page.request.post("/api/auth/sign-in/email", {
    data: { email: "analyst@cirque.test", password },
    headers,
  });
  expect((await signIn.json()).twoFactorRedirect).toBe(true);
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-backup-code", {
        data: { code: backupCodes[1] },
        headers,
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-totp", {
        data: { code: codeAt(secret, 1) },
        headers,
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-backup-code", {
        data: { code: recoveryCodes![0] },
        headers,
      })
    ).status(),
  ).toBe(200);
});

test("proof is bound to action and session; replacement cancels or expires without removing the old factor", async ({
  page,
  browser,
}) => {
  const { backupCodes } = await enroll(page, "lead@cirque.test");
  const other = await browser.newContext();
  try {
    const signIn = await other.request.post("/api/auth/sign-in/email", {
      data: { email: "lead@cirque.test", password },
      headers,
    });
    expect((await signIn.json()).twoFactorRedirect).toBe(true);
    expect(
      (
        await other.request.post("/api/auth/two-factor/verify-backup-code", {
          data: { code: backupCodes[0] },
          headers,
        })
      ).status(),
    ).toBe(200);
    const proofResponse = await prove(page, "replace", backupCodes[1]);
    const proof = (await actionData(proofResponse)).proof as string;
    expect((await prove(page, "replace", backupCodes[1])).status()).toBe(400);
    expect(
      (
        await page.request.post("/profile?/disableMfa", { form: { proof }, headers: actionHeaders })
      ).status(),
    ).toBe(400);
    expect(
      (
        await other.request.post("/profile?/beginReplacement", {
          form: { proof },
          headers: actionHeaders,
        })
      ).status(),
    ).toBe(400);
    const first = await page.request.post("/profile?/beginReplacement", {
      form: { proof },
      headers: actionHeaders,
    });
    expect((await actionData(first)).replacementURI).toBeTruthy();
    expect(
      (await other.request.get("/incidents/INC-104/report", { maxRedirects: 0 })).headers()
        .location,
    ).toBe("/profile?setup=replace");
    const cancel = await page.request.post("/profile?/cancelReplacement", {
      form: {},
      headers: actionHeaders,
    });
    expect((await actionData(cancel)).cancelled).toBe(true);
    expect((await page.request.get("/dashboard")).status()).toBe(200);
    expect((await other.request.get("/incidents/INC-104/report")).status()).toBe(200);
    const nextProof = (await actionData(await prove(page, "replace", backupCodes[2])))
      .proof as string;
    const competitors = await Promise.all(
      [0, 1].map(() =>
        page.request.post("/profile?/beginReplacement", {
          form: { proof: nextProof },
          headers: actionHeaders,
        }),
      ),
    );
    const outcomes = await Promise.all(competitors.map((result) => result.json()));
    expect(outcomes.filter((result) => result.type === "success")).toHaveLength(1);
    expect(outcomes.filter((result) => result.type === "failure")).toHaveLength(1);
    const storage = database();
    storage
      .prepare(
        "UPDATE mfa_pending_replacement SET expires_at = 0 WHERE user_id = (SELECT id FROM user WHERE email = ?)",
      )
      .run("lead@cirque.test");
    storage.close();
    expect(
      (
        await page.request.post("/profile?/confirmReplacement", {
          form: { code: "123456" },
          headers: actionHeaders,
        })
      ).status(),
    ).toBe(400);
    expect((await other.request.get("/dashboard")).status()).toBe(200);
    expect((await other.request.get("/incidents/INC-104/report")).status()).toBe(200);
    const expiringProof = (await actionData(await prove(page, "replace", backupCodes[3])))
      .proof as string;
    const writable = database();
    writable
      .prepare(
        "UPDATE mfa_action_proof SET expires_at = 0 WHERE user_id = (SELECT id FROM user WHERE email = ?)",
      )
      .run("lead@cirque.test");
    writable.close();
    expect(
      (
        await page.request.post("/profile?/beginReplacement", {
          form: { proof: expiringProof },
          headers: actionHeaders,
        })
      ).status(),
    ).toBe(400);
  } finally {
    await other.close();
  }
});

test("Profile replacement journey renders QR, confirms and shows new codes once", async ({
  page,
}) => {
  const { backupCodes } = await enroll(page, "analyst@cirque.test");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Replace authenticator" })).toBeVisible();
  await page.screenshot({ path: "docs/private/profile-mfa-enabled-1280.png", fullPage: true });
  await page.getByRole("button", { name: "Replace authenticator" }).click();
  await page.getByLabel("Current password").fill(password);
  await page.getByLabel("Current authenticator or recovery code").fill(backupCodes[0]);
  await page.getByRole("button", { name: "Verify to replace" }).click();
  await expect(page.getByRole("button", { name: "Start replacement" })).toBeVisible();
  await page.getByRole("button", { name: "Start replacement" }).click();
  await expect(page.getByRole("heading", { name: "Connect your new authenticator" })).toBeVisible();
  await expect(page.getByAltText("Cirque replacement authenticator QR code")).toBeVisible();
  await page.getByText("Use a manual setup key instead").click();
  const newSecret = await page.getByTestId("replacement-secret").textContent();
  expect(newSecret).toBeTruthy();
  await page.screenshot({ path: "docs/private/profile-mfa-replacing-1280.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.locator("#workspace-sidebar").evaluate((sidebar) => sidebar.getBoundingClientRect().x),
    )
    .toBeLessThan(-240);
  await page.screenshot({ path: "docs/private/profile-mfa-replacing-390.png" });
  await page.getByLabel("Code from new authenticator").fill(codeAt(newSecret!));
  const validity = await page.locator('form[action*="confirmReplacement"]').evaluate((form) => ({
    valid: (form as HTMLFormElement).checkValidity(),
    issues: [...(form as HTMLFormElement).elements]
      .filter((element) => !(element as HTMLInputElement).checkValidity())
      .map((element) => ({
        name: (element as HTMLInputElement).name,
        message: (element as HTMLInputElement).validationMessage,
        length: (element as HTMLInputElement).value.length,
      })),
  }));
  expect(validity.valid, JSON.stringify(validity.issues)).toBe(true);
  const confirmationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/profile",
  );
  await page.getByRole("button", { name: "Confirm replacement" }).click();
  const confirmation = await confirmationResponse;
  const outcome = await confirmation.json();
  expect(outcome.type, `confirmation status ${confirmation.status()}`).toBe("success");
  await expect(page.getByRole("heading", { name: "Authenticator replaced" })).toBeVisible();
  await expect(page.locator(".replacement-complete .codes code")).toHaveCount(10);
  await expect(page.getByRole("button", { name: /Account menu/ })).toHaveCount(0);
  await page.screenshot({ path: "docs/private/profile-mfa-completed-390.png" });
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
});

test("Profile disable journey confirms consequences and signs out", async ({ page }) => {
  const { backupCodes } = await enroll(page, "analyst@cirque.test");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Disable authenticator" }).click();
  await page.getByLabel("Current password").fill(password);
  await page.getByLabel("Current authenticator or recovery code").fill(backupCodes[0]);
  await page.getByRole("button", { name: "Verify to disable" }).click();
  await expect(
    page.getByRole("button", { name: "Disable authenticator and sign out" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Disable authenticator and sign out" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/private/profile-mfa-disable-confirm-1280.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.locator("#workspace-sidebar").evaluate((sidebar) => sidebar.getBoundingClientRect().x),
    )
    .toBeLessThan(-240);
  await page
    .getByRole("button", { name: "Disable authenticator and sign out" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/private/profile-mfa-disable-confirm-390.png" });
  await page.getByRole("button", { name: "Disable authenticator and sign out" }).click();
  await expect(page).toHaveURL(/\/login\?mfa=disabled/);
  await expect(
    page.getByText("Authenticator disabled. All sessions were signed out.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/private/profile-mfa-disabled-390.png" });
});
