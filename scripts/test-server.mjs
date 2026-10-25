import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
process.env.BETTER_AUTH_SECRET = "local-test-only-auth-secret-do-not-deploy";
const port = process.env.TEST_PORT ?? "3000";
process.env.BETTER_AUTH_URL = `http://127.0.0.1:${port}`;
process.env.ORIGIN = process.env.BETTER_AUTH_URL;
process.env.SQLITE_PATH = `./data/test-${Date.now()}.sqlite`;
process.env.LOCAL_TEST = "1";
process.env.LOCAL_TEST_PASSWORD = "local-test-only-passphrase";
process.env.CIRQUE_MAIL_MODE = "file";
process.env.CIRQUE_MAIL_DIR = `./data/test-mail-${Date.now()}`;
process.env.HOST = "127.0.0.1";
process.env.PORT = port;
const seed = spawnSync(process.execPath, ["scripts/seed-local.ts"], {
  env: process.env,
  stdio: "inherit",
});
if (seed.status !== 0) process.exit(1);
writeFileSync(
  "data/test-run.json",
  JSON.stringify({
    database: process.env.SQLITE_PATH,
    mailDirectory: process.env.CIRQUE_MAIL_DIR,
  }),
);
await import("../test-build/index.js");
