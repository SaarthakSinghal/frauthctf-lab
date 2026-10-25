import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import Database from "better-sqlite3";
import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  backupCodeStorage,
  consumeTotpStep,
  matchBackupCode,
  matchingTotpStep,
} from "./mfa-policy.js";
import { getWorkspaceDatabase } from "./workspace.js";

export type MfaAction = "disable" | "replace";

type Factor = {
  id: string;
  secret: string;
  backupCodes: string;
};

type Proof = {
  user_id: string;
  session_hash: string;
  action: MfaAction;
  factor_id: string;
  factor_digest: string;
  expires_at: number;
};

type Pending = {
  user_id: string;
  session_hash: string;
  factor_id: string;
  factor_digest: string;
  secret: string;
  expires_at: number;
};

const PROOF_LIFETIME_MS = 5 * 60 * 1000;
const REPLACEMENT_LIFETIME_MS = 10 * 60 * 1000;
const ATTEMPT_WINDOW_SECONDS = 15 * 60;
const ATTEMPT_LIMIT = 5;
const RECOVERY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function authSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Auth secret is not configured");
  return secret;
}

function activeFactor(database: Database.Database, userId: string) {
  return database
    .prepare(
      `SELECT factor.id, factor.secret, factor.backupCodes
       FROM twoFactor AS factor JOIN user ON user.id = factor.userId
       WHERE factor.userId = ? AND factor.verified = 1 AND user.twoFactorEnabled = 1`,
    )
    .get(userId) as Factor | undefined;
}

function matchingFactor(database: Database.Database, userId: string, proof: Proof | Pending) {
  const factor = activeFactor(database, userId);
  return factor?.id === proof.factor_id && digest(factor.secret) === proof.factor_digest
    ? factor
    : null;
}

function validProof(
  database: Database.Database,
  token: string,
  userId: string,
  sessionToken: string,
  action: MfaAction,
) {
  const proof = database
    .prepare("SELECT * FROM mfa_action_proof WHERE proof_hash = ?")
    .get(digest(token)) as Proof | undefined;
  if (
    !proof ||
    proof.user_id !== userId ||
    proof.session_hash !== digest(sessionToken) ||
    proof.action !== action ||
    proof.expires_at <= Date.now() ||
    !matchingFactor(database, userId, proof)
  ) {
    return null;
  }
  return proof;
}

function invalidateSessions(database: Database.Database, userId: string) {
  const challenges = database
    .prepare("SELECT identifier FROM verification WHERE identifier LIKE '2fa-%' AND value = ?")
    .all(userId) as { identifier: string }[];
  const removeChallenge = database.prepare("DELETE FROM verification WHERE identifier = ?");
  for (const challenge of challenges) {
    removeChallenge.run(`2fa-attempts-${challenge.identifier}`);
    removeChallenge.run(challenge.identifier);
  }
  database.prepare("DELETE FROM session WHERE userId = ?").run(userId);
}

function securityEvent(database: Database.Database, userId: string, action: string) {
  database
    .prepare("INSERT INTO mfa_security_event (user_id, action, created_at) VALUES (?, ?, ?)")
    .run(userId, action, new Date().toISOString());
}

function base32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  let result = "";
  for (const byte of Buffer.from(value, "utf8")) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}

function setupURI(secret: string, email: string) {
  const parameters = new URLSearchParams({
    secret: base32(secret),
    issuer: "Cirque",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/Cirque:${encodeURIComponent(email)}?${parameters}`;
}

function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const code = Array.from(
      { length: 10 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join("");
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

export function allowMfaActionAttempt(userId: string) {
  const database = getWorkspaceDatabase();
  const now = Math.floor(Date.now() / 1000);
  const resetBefore = now - ATTEMPT_WINDOW_SECONDS;
  database
    .prepare(
      `INSERT INTO mfa_action_attempt (user_id, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET
         window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END,
         count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END`,
    )
    .run(userId, now, resetBefore, resetBefore);
  const row = database
    .prepare("SELECT count FROM mfa_action_attempt WHERE user_id = ?")
    .get(userId) as { count: number };
  return row.count <= ATTEMPT_LIMIT;
}

export async function issueMfaProof(
  userId: string,
  sessionToken: string,
  action: MfaAction,
  code: string,
) {
  const database = getWorkspaceDatabase();
  const factor = activeFactor(database, userId);
  if (!factor) return null;
  const secret = await symmetricDecrypt({ key: authSecret(), data: factor.secret });
  const step = await matchingTotpStep(secret, code);
  const token = randomBytes(32).toString("base64url");
  const issued = database
    .transaction(() => {
      const current = activeFactor(database, userId);
      if (!current || current.id !== factor.id || current.secret !== factor.secret) return false;
      if (step !== null) {
        if (!consumeTotpStep(database, userId, step)) return false;
      } else {
        const matched = matchBackupCode(current.backupCodes, code);
        if (!matched) return false;
        const remaining = (
          JSON.parse(current.backupCodes.slice("scrypt-v1:".length)) as string[]
        ).filter((entry) => entry !== matched);
        database
          .prepare("UPDATE twoFactor SET backupCodes = ? WHERE id = ?")
          .run(`scrypt-v1:${JSON.stringify(remaining)}`, current.id);
      }
      database
        .prepare(
          `INSERT INTO mfa_action_proof
         (proof_hash, user_id, session_hash, action, factor_id, factor_digest, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          digest(token),
          userId,
          digest(sessionToken),
          action,
          current.id,
          digest(current.secret),
          Date.now() + PROOF_LIFETIME_MS,
        );
      return true;
    })
    .immediate();
  return issued ? token : null;
}

export function disableMfa(userId: string, sessionToken: string, token: string) {
  const database = getWorkspaceDatabase();
  return database
    .transaction(() => {
      if (!validProof(database, token, userId, sessionToken, "disable")) return false;
      database.prepare("DELETE FROM twoFactor WHERE userId = ?").run(userId);
      database.prepare("UPDATE user SET twoFactorEnabled = 0 WHERE id = ?").run(userId);
      database.prepare("DELETE FROM mfa_used_totp WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM mfa_pending_replacement WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM mfa_action_proof WHERE user_id = ?").run(userId);
      invalidateSessions(database, userId);
      securityEvent(database, userId, "mfa_disabled");
      return true;
    })
    .immediate();
}

export async function beginReplacement(
  userId: string,
  sessionToken: string,
  token: string,
  email: string,
) {
  const database = getWorkspaceDatabase();
  const oldFactor = activeFactor(database, userId);
  if (!oldFactor) return null;
  const oldSecret = await symmetricDecrypt({ key: authSecret(), data: oldFactor.secret });
  let newSecret = randomBytes(24).toString("base64url");
  while (newSecret === oldSecret) newSecret = randomBytes(24).toString("base64url");
  const encrypted = await symmetricEncrypt({ key: authSecret(), data: newSecret });
  const created = database
    .transaction(() => {
      const proof = validProof(database, token, userId, sessionToken, "replace");
      if (!proof) return false;
      database
        .prepare("DELETE FROM mfa_pending_replacement WHERE user_id = ? AND expires_at <= ?")
        .run(userId, Date.now());
      if (database.prepare("SELECT 1 FROM mfa_pending_replacement WHERE user_id = ?").get(userId)) {
        return false;
      }
      database.prepare("DELETE FROM mfa_action_proof WHERE proof_hash = ?").run(digest(token));
      database
        .prepare(
          `INSERT INTO mfa_pending_replacement
         (user_id, session_hash, factor_id, factor_digest, secret, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          digest(sessionToken),
          proof.factor_id,
          proof.factor_digest,
          encrypted,
          Date.now() + REPLACEMENT_LIFETIME_MS,
        );
      return true;
    })
    .immediate();
  return created ? setupURI(newSecret, email) : null;
}

export async function pendingReplacement(userId: string, sessionToken: string, email: string) {
  const database = getWorkspaceDatabase();
  const pending = database
    .prepare("SELECT * FROM mfa_pending_replacement WHERE user_id = ?")
    .get(userId) as Pending | undefined;
  if (
    !pending ||
    pending.session_hash !== digest(sessionToken) ||
    pending.expires_at <= Date.now() ||
    !matchingFactor(database, userId, pending)
  ) {
    return null;
  }
  const secret = await symmetricDecrypt({ key: authSecret(), data: pending.secret });
  return setupURI(secret, email);
}

export function cancelReplacement(userId: string, sessionToken: string) {
  const result = getWorkspaceDatabase()
    .prepare("DELETE FROM mfa_pending_replacement WHERE user_id = ? AND session_hash = ?")
    .run(userId, digest(sessionToken));
  return result.changes === 1;
}

export async function confirmReplacement(userId: string, sessionToken: string, code: string) {
  const database = getWorkspaceDatabase();
  const pending = database
    .prepare("SELECT * FROM mfa_pending_replacement WHERE user_id = ?")
    .get(userId) as Pending | undefined;
  if (
    !pending ||
    pending.session_hash !== digest(sessionToken) ||
    pending.expires_at <= Date.now() ||
    !matchingFactor(database, userId, pending)
  ) {
    return null;
  }
  const newSecret = await symmetricDecrypt({ key: authSecret(), data: pending.secret });
  const step = await matchingTotpStep(newSecret, code);
  if (step === null) return null;
  const recoveryCodes = newRecoveryCodes();
  const storedCodes = await backupCodeStorage.encrypt(JSON.stringify(recoveryCodes));
  const completed = database
    .transaction(() => {
      const current = database
        .prepare("SELECT * FROM mfa_pending_replacement WHERE user_id = ?")
        .get(userId) as Pending | undefined;
      if (
        !current ||
        current.secret !== pending.secret ||
        current.session_hash !== digest(sessionToken) ||
        current.expires_at <= Date.now() ||
        !matchingFactor(database, userId, current)
      ) {
        return false;
      }
      database.prepare("DELETE FROM mfa_used_totp WHERE user_id = ?").run(userId);
      if (!consumeTotpStep(database, userId, step))
        throw new Error("Unable to reserve the replacement authenticator step");
      database
        .prepare("UPDATE twoFactor SET secret = ?, backupCodes = ?, verified = 1 WHERE id = ?")
        .run(current.secret, storedCodes, current.factor_id);
      database.prepare("DELETE FROM mfa_pending_replacement WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM mfa_action_proof WHERE user_id = ?").run(userId);
      invalidateSessions(database, userId);
      securityEvent(database, userId, "mfa_replaced");
      return true;
    })
    .immediate();
  return completed ? recoveryCodes : null;
}
