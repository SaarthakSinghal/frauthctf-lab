import { symmetricDecrypt } from "better-auth/crypto";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { backupCodeStorage } from "../src/lib/server/mfa-policy.ts";

if (
  process.env.LOCAL_TEST !== "1" ||
  !process.env.BETTER_AUTH_SECRET ||
  !process.env.BETTER_AUTH_URL
) {
  throw new Error("Explicit local-test configuration is required");
}
const origin = new URL(process.env.BETTER_AUTH_URL);
if (!["localhost", "127.0.0.1"].includes(origin.hostname))
  throw new Error("Loopback origin required");
const database = new Database(resolve(process.env.SQLITE_PATH ?? "./data/local.sqlite"));
const rows = database
  .prepare("SELECT id, backupCodes FROM twoFactor WHERE backupCodes NOT LIKE 'scrypt-v1:%'")
  .all() as {
  id: string;
  backupCodes: string;
}[];
for (const row of rows) {
  const plaintext = await symmetricDecrypt({
    key: process.env.BETTER_AUTH_SECRET,
    data: row.backupCodes,
  });
  const hashed = await backupCodeStorage.encrypt(plaintext);
  database
    .prepare("UPDATE twoFactor SET backupCodes = ? WHERE id = ? AND backupCodes = ?")
    .run(hashed, row.id, row.backupCodes);
}
database.close();
console.log(`Converted ${rows.length} local factor record(s) to one-way recovery-code storage.`);
