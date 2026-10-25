import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function resetLocalFixture() {
  const { database } = JSON.parse(readFileSync("data/test-run.json", "utf8")) as {
    database: string;
  };
  const port = process.env.TEST_PORT ?? "3000";
  const result = spawnSync(process.execPath, ["scripts/seed-local.ts"], {
    env: {
      ...process.env,
      BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
      BETTER_AUTH_SECRET: "local-test-only-auth-secret-do-not-deploy",
      SQLITE_PATH: database,
      LOCAL_TEST: "1",
      LOCAL_TEST_PASSWORD: "local-test-only-passphrase",
    },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Local test fixture reset failed: ${result.stderr}`);
}
