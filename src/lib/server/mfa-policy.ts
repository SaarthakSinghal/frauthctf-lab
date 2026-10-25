import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";

const HASH_PREFIX = "scrypt-v1:";
const CODE_PATTERN = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW_STEPS = 1;

export function initializeMfaPolicy(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mfa_used_totp (
      user_id TEXT NOT NULL,
      time_step INTEGER NOT NULL,
      PRIMARY KEY (user_id, time_step)
    );
    CREATE TABLE IF NOT EXISTS mfa_action_attempt (
      user_id TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mfa_action_proof (
      proof_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_hash TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('disable', 'replace')),
      factor_id TEXT NOT NULL,
      factor_digest TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mfa_pending_replacement (
      user_id TEXT PRIMARY KEY,
      session_hash TEXT NOT NULL,
      factor_id TEXT NOT NULL,
      factor_digest TEXT NOT NULL,
      secret TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mfa_security_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('mfa_disabled', 'mfa_replaced')),
      created_at TEXT NOT NULL
    );
  `);
  const table = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'twoFactor'")
    .get();
  if (
    table &&
    database
      .prepare("SELECT 1 FROM twoFactor WHERE backupCodes NOT LIKE 'scrypt-v1:%' LIMIT 1")
      .get()
  ) {
    throw new Error(
      "Legacy recovery-code storage detected. Run the documented local MFA transition before starting Cirque.",
    );
  }
}

function hashCode(code: string) {
  const salt = randomBytes(16);
  const digest = scryptSync(code, salt, 32);
  return `${salt.toString("hex")}:${digest.toString("hex")}`;
}

export const backupCodeStorage = {
  async encrypt(json: string) {
    const entries = JSON.parse(json) as string[];
    return (
      HASH_PREFIX +
      JSON.stringify(entries.map((entry) => (entry.includes(":") ? entry : hashCode(entry))))
    );
  },
  async decrypt(stored: string) {
    if (!stored.startsWith(HASH_PREFIX))
      throw new Error("Unsupported recovery-code storage format");
    return stored.slice(HASH_PREFIX.length);
  },
};

export function matchBackupCode(stored: string, supplied: string): string | null {
  if (!CODE_PATTERN.test(supplied) || !stored.startsWith(HASH_PREFIX)) return null;
  const hashes = JSON.parse(stored.slice(HASH_PREFIX.length)) as string[];
  let match: string | null = null;
  for (const entry of hashes) {
    const [saltHex, digestHex] = entry.split(":");
    if (!saltHex || !digestHex) continue;
    const digest = Buffer.from(digestHex, "hex");
    const candidate = scryptSync(supplied, Buffer.from(saltHex, "hex"), digest.length);
    if (timingSafeEqual(candidate, digest)) match = entry;
  }
  return match;
}

export async function matchingTotpStep(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / (TOTP_PERIOD_SECONDS * 1000));
  let match: number | null = null;
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset++) {
    const step = current + offset;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac("sha1", secret).update(counter).digest();
    const position = digest[digest.length - 1] & 15;
    const generated = ((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000)
      .toString()
      .padStart(6, "0");
    const same = timingSafeEqual(Buffer.from(code), Buffer.from(generated));
    if (same) match = step;
  }
  return match;
}

export function consumeTotpStep(database: Database.Database, userId: string, step: number) {
  const result = database
    .prepare("INSERT OR IGNORE INTO mfa_used_totp (user_id, time_step) VALUES (?, ?)")
    .run(userId, step);
  return result.changes === 1;
}
