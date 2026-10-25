import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createHmac, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetLocalFixture } from "./fixture.ts";

test.beforeEach(() => resetLocalFixture());

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

test("lead MFA gate, replay, recovery, and password reset", async ({ page, request }) => {
  test.setTimeout(180000);
  const origin = `http://127.0.0.1:${process.env.TEST_PORT ?? 3000}`;
  const headers = { Origin: origin };
  const credentials = {
    email: "lead@cirque.test",
    password: "local-test-only-passphrase",
  };
  expect((await request.get("/profile", { maxRedirects: 0 })).status()).toBe(303);
  const signIn = await page.request.post("/api/auth/sign-in/email", {
    data: credentials,
    headers,
  });
  expect(signIn.ok()).toBe(true);
  const leadReport = await page.request.get("/incidents/INC-104/report", {
    maxRedirects: 0,
  });
  expect(leadReport.status()).toBe(303);
  expect(leadReport.headers().location).toBe("/profile?setup=required");
  await page.goto("/profile?setup=required");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByText("A response lead needs an authenticator")).toBeVisible();
  await expect(page.locator(".profile-facts dd", { hasText: "Priya Shah" })).toBeVisible();
  await expect(page.locator(".profile-facts dd", { hasText: "lead@cirque.test" })).toBeVisible();
  const disclosure = page.getByText("Why is it called two-factor?");
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.getByText(/Signing in checks two different things/)).toBeVisible();
  const enrollment = await page.request.post("/api/auth/two-factor/enable", {
    data: { password: credentials.password },
    headers,
  });
  expect(enrollment.ok()).toBe(true);
  const result = await enrollment.json();
  const secret = new URL(result.totpURI).searchParams.get("secret")!;
  const backup = result.backupCodes[0] as string;
  const firstCode = codeAt(secret);
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-totp", {
        data: { code: firstCode },
        headers,
      })
    ).status(),
  ).toBe(200);
  const databasePath = JSON.parse(readFileSync("data/test-run.json", "utf8")).database;
  const database = new Database(databasePath, { readonly: true });
  const stored = database
    .prepare(
      "SELECT backupCodes FROM twoFactor WHERE userId = (SELECT id FROM user WHERE email = ?)",
    )
    .get(credentials.email) as { backupCodes: string };
  expect(stored.backupCodes.startsWith("scrypt-v1:")).toBe(true);
  expect(stored.backupCodes).not.toContain(backup);
  database.close();
  expect((await page.request.get("/incidents/INC-104/report")).status()).toBe(200);
  const writableFactorDatabase = new Database(databasePath);
  writableFactorDatabase
    .prepare(
      "UPDATE twoFactor SET verified = 0 WHERE userId = (SELECT id FROM user WHERE email = ?)",
    )
    .run(credentials.email);
  expect(
    (await page.request.get("/incidents/INC-104/report", { maxRedirects: 0 })).headers().location,
  ).toBe("/profile?setup=required");
  writableFactorDatabase
    .prepare(
      "UPDATE twoFactor SET verified = 1 WHERE userId = (SELECT id FROM user WHERE email = ?)",
    )
    .run(credentials.email);
  writableFactorDatabase.close();
  await new Promise((resolve) => setTimeout(resolve, 10100));
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-totp", {
        data: { code: firstCode },
        headers,
      })
    ).status(),
  ).toBe(401);
  await page.request.post("/api/auth/sign-out", { data: {}, headers });
  expect(
    (
      await (
        await page.request.post("/api/auth/sign-in/email", {
          data: credentials,
          headers,
        })
      ).json()
    ).twoFactorRedirect,
  ).toBe(true);
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-totp", {
        data: { code: firstCode },
        headers,
      })
    ).status(),
  ).toBe(401);
  expect((await page.request.get("/dashboard", { maxRedirects: 0 })).status()).toBe(303);
  expect((await page.request.get("/incidents/INC-104/report", { maxRedirects: 0 })).status()).toBe(
    303,
  );
  await new Promise((resolve) => setTimeout(resolve, 10100));
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-backup-code", {
        data: { code: backup },
        headers,
      })
    ).status(),
  ).toBe(200);
  const oldCookie = (await page.context().cookies()).find((cookie) =>
    cookie.name.endsWith("session_token"),
  )!;
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If that address belongs to a Cirque account/)).toBeVisible();
  const mailDirectory = JSON.parse(readFileSync("data/test-run.json", "utf8"))
    .mailDirectory as string;
  const mailbox = createHash("sha256").update(credentials.email).digest("hex") + ".json";
  const message = JSON.parse(readFileSync(join(mailDirectory, mailbox), "utf8")) as {
    text: string;
  };
  const link = message.text.match(/http:\/\/127\.0\.0\.1:\d+\/reset-password\/\S+/)![0];
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill("new-local-test-passphrase");
  await page.getByLabel("Confirm new password", { exact: true }).fill("new-local-test-passphrase");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();
  expect(
    (
      await request.get("/dashboard", {
        headers: { Cookie: `${oldCookie.name}=${oldCookie.value}` },
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(303);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Link unavailable" })).toBeVisible();
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  const expiredMessage = JSON.parse(readFileSync(join(mailDirectory, mailbox), "utf8")) as {
    text: string;
  };
  const expiredLink = expiredMessage.text.match(
    /http:\/\/127\.0\.0\.1:\d+\/reset-password\/\S+/,
  )![0];
  const expiredToken = new URL(expiredLink).pathname.split("/").at(-1)!;
  const writableDatabase = new Database(databasePath);
  writableDatabase
    .prepare("UPDATE verification SET expiresAt = ? WHERE identifier = ?")
    .run(new Date(0).toISOString(), `reset-password:${expiredToken}`);
  writableDatabase.close();
  await page.goto(expiredLink);
  await expect(page.getByRole("heading", { name: "Link unavailable" })).toBeVisible();
  const oldLogin = await page.request.post("/api/auth/sign-in/email", {
    data: credentials,
    headers,
  });
  expect(oldLogin.ok()).toBe(false);
  const nextLogin = await page.request.post("/api/auth/sign-in/email", {
    data: { ...credentials, password: "new-local-test-passphrase" },
    headers,
  });
  expect((await nextLogin.json()).twoFactorRedirect).toBe(true);
  expect((await page.request.get("/dashboard", { maxRedirects: 0 })).status()).toBe(303);
  expect((await page.request.get("/incidents/INC-104/report", { maxRedirects: 0 })).status()).toBe(
    303,
  );
});

test("parallel factor submissions redeem each value once", async ({ browser }) => {
  test.setTimeout(120000);
  const origin = `http://127.0.0.1:${process.env.TEST_PORT ?? 3000}`;
  const headers = { Origin: origin };
  const credentials = {
    email: "analyst@cirque.test",
    password: "local-test-only-passphrase",
  };
  const setup = await browser.newContext();
  try {
    await setup.request.post("/api/auth/sign-in/email", {
      data: credentials,
      headers,
    });
    const enrollment = await setup.request.post("/api/auth/two-factor/enable", {
      data: { password: credentials.password },
      headers,
    });
    expect(enrollment.status()).toBe(200);
    const { totpURI, backupCodes } = await enrollment.json();
    const secret = new URL(totpURI).searchParams.get("secret")!;
    expect(
      (
        await setup.request.post("/api/auth/two-factor/verify-totp", {
          data: { code: codeAt(secret) },
          headers,
        })
      ).status(),
    ).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10100));
    const first = await browser.newContext();
    const second = await browser.newContext();
    try {
      for (const context of [first, second]) {
        expect(
          (
            await (
              await context.request.post("/api/auth/sign-in/email", {
                data: credentials,
                headers,
              })
            ).json()
          ).twoFactorRedirect,
        ).toBe(true);
      }
      const freshCode = codeAt(secret, 1);
      const totpResults = await Promise.all(
        [first, second].map((context) =>
          context.request.post("/api/auth/two-factor/verify-totp", {
            data: { code: freshCode },
            headers,
          }),
        ),
      );
      expect(
        totpResults.map((result) => result.status()).filter((status) => status === 200),
      ).toHaveLength(1);
      expect(totpResults.map((result) => result.status())).not.toContain(429);
      await new Promise((resolve) => setTimeout(resolve, 10100));
      const third = await browser.newContext();
      const fourth = await browser.newContext();
      try {
        for (const context of [third, fourth]) {
          expect(
            (
              await (
                await context.request.post("/api/auth/sign-in/email", {
                  data: credentials,
                  headers,
                })
              ).json()
            ).twoFactorRedirect,
          ).toBe(true);
        }
        const recoveryResults = await Promise.all(
          [third, fourth].map((context) =>
            context.request.post("/api/auth/two-factor/verify-backup-code", {
              data: { code: backupCodes[0] },
              headers,
            }),
          ),
        );
        expect(
          recoveryResults.map((result) => result.status()).filter((status) => status === 200),
        ).toHaveLength(1);
        expect(recoveryResults.map((result) => result.status())).not.toContain(429);
      } finally {
        await third.close();
        await fourth.close();
      }
    } finally {
      await first.close();
      await second.close();
    }
  } finally {
    await setup.close();
  }
});

test("reset requests stay generic, origin-protected, and rate-limited", async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post("/api/auth/request-password-reset", {
        data: { email: "lead@cirque.test" },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/forgot-password", {
        form: { email: "lead@cirque.test" },
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
  const responses: string[] = [];
  for (const email of ["lead@cirque.test", "nobody@cirque.test"]) {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    responses.push((await page.getByRole("status").textContent())!);
  }
  expect(responses[0]).toBe(responses[1]);
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("nobody@cirque.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("nobody@cirque.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Too many requests. Try again in 15 minutes.")).toBeVisible();
  const tokenStatuses = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await request.post("/api/auth/reset-password", {
      data: { token: "invalid-token", newPassword: "some-long-test-password" },
      headers: { Origin: `http://127.0.0.1:${process.env.TEST_PORT ?? 3000}` },
    });
    tokenStatuses.push(response.status());
  }
  expect(tokenStatuses).toContain(429);
});
