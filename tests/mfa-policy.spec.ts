import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { symmetricEncrypt } from "better-auth/crypto";
import {
  backupCodeStorage,
  consumeTotpStep,
  initializeMfaPolicy,
  matchBackupCode,
  matchingTotpStep,
} from "../src/lib/server/mfa-policy.js";

function codeAt(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const position = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

test("TOTP steps are consumed atomically across attempts and restarts", async () => {
  const folder = mkdtempSync(join(tmpdir(), "cirque-mfa-"));
  const path = join(folder, "factor.sqlite");
  try {
    const database = new Database(path);
    initializeMfaPolicy(database);
    const secret = "Local-only-TOTP-secret-for-tests";
    const now = Math.floor(Date.now() / 30000) * 30000 + 15000;
    const step = Math.floor(now / 30000);
    for (const offset of [-1, 0, 1]) {
      expect(await matchingTotpStep(secret, codeAt(secret, step + offset), now)).toBe(
        step + offset,
      );
    }
    expect(await matchingTotpStep(secret, codeAt(secret, step - 2), now)).toBeNull();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, async () => consumeTotpStep(database, "person", step)),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    database.close();
    const restarted = new Database(path);
    initializeMfaPolicy(restarted);
    expect(consumeTotpStep(restarted, "person", step)).toBe(false);
    expect(consumeTotpStep(restarted, "person", step + 1)).toBe(true);
    expect(await matchingTotpStep(secret, codeAt(secret, step + 2), now + 60000)).toBe(step + 2);
    restarted.close();
  } finally {
    unlinkSync(path);
    rmdirSync(folder);
  }
});

test("recovery codes are salted one-way values and remain single use", async () => {
  const plaintext = "AbCdE-12345";
  const stored = await backupCodeStorage.encrypt(JSON.stringify([plaintext]));
  expect(stored).not.toContain(plaintext);
  const matched = matchBackupCode(stored, plaintext);
  expect(matched).toBeTruthy();
  expect(matchBackupCode(stored, matched!)).toBeNull();
  const remaining = await backupCodeStorage.encrypt(JSON.stringify([]));
  expect(matchBackupCode(remaining, plaintext)).toBeNull();
  expect(await backupCodeStorage.decrypt(stored)).toContain(matched!);
});

test("explicit local migration converts legacy ciphertext without exposing codes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "cirque-migration-"));
  const path = join(folder, "factor.sqlite");
  const secret = "local-migration-test-secret-not-for-release";
  const code = "AbCdE-12345";
  try {
    const database = new Database(path);
    database.exec("CREATE TABLE twoFactor (id TEXT PRIMARY KEY, backupCodes TEXT NOT NULL)");
    const encrypted = await symmetricEncrypt({
      key: secret,
      data: JSON.stringify([code]),
    });
    database.prepare("INSERT INTO twoFactor VALUES (?, ?)").run("factor", encrypted);
    expect(() => initializeMfaPolicy(database)).toThrow(/Legacy recovery-code storage/);
    database.close();
    const result = spawnSync(process.execPath, ["scripts/migrate-local-mfa.ts"], {
      env: {
        ...process.env,
        LOCAL_TEST: "1",
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
        BETTER_AUTH_SECRET: secret,
        SQLITE_PATH: path,
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(code);
    const migrated = new Database(path);
    initializeMfaPolicy(migrated);
    const stored = migrated
      .prepare("SELECT backupCodes FROM twoFactor WHERE id = ?")
      .get("factor") as { backupCodes: string };
    expect(stored.backupCodes.startsWith("scrypt-v1:")).toBe(true);
    expect(matchBackupCode(stored.backupCodes, code)).toBeTruthy();
    migrated.close();
  } finally {
    unlinkSync(path);
    rmdirSync(folder);
  }
});
