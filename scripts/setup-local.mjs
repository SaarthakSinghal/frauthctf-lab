import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

if (!existsSync(".env.local")) {
  writeFileSync(
    ".env.local",
    `BETTER_AUTH_URL=http://127.0.0.1:3000\nBETTER_AUTH_SECRET=${randomBytes(48).toString(
      "base64url",
    )}\nSQLITE_PATH=./data/local.sqlite\nLOCAL_TEST=1\nLOCAL_TEST_PASSWORD=local-test-only-passphrase\nHOST=127.0.0.1\nPORT=3000\n`,
    { mode: 0o600 },
  );
}
console.log("Local configuration ready. Test accounts: analyst@cirque.test and lead@cirque.test");
