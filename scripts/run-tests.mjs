import { spawn, spawnSync } from "node:child_process";

const port = process.env.TEST_PORT ?? "3000";
const environment = {
  ...process.env,
  TEST_PORT: port,
  BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
  FRAUTH_TEST_BUILD: "1",
};
try {
  await fetch(`http://127.0.0.1:${port}/login`, {
    signal: AbortSignal.timeout(1000),
  });
  throw new Error(`Port ${port} already has a server; stop it or choose TEST_PORT before testing`);
} catch (error) {
  if (error instanceof Error && error.message.includes("already has a server")) throw error;
}
const build = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  env: environment,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(process.execPath, ["scripts/test-server.mjs"], {
  env: environment,
  stdio: "inherit",
});
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  if (server.exitCode !== null) break;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/login`, {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  server.kill();
  throw new Error(`Production test server did not start on port ${port}`);
}

const test = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
  {
    env: { ...environment, EXTERNAL_TEST_SERVER: "1" },
    stdio: "inherit",
  },
);
const exitCode = await new Promise((resolve) => test.once("exit", (code) => resolve(code ?? 1)));
server.kill();
process.exit(exitCode);
