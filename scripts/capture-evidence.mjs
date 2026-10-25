import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const started = performance.now();
const port = process.env.PORT ?? "3000";
await import("../build/index.js");
for (;;) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/login`)).ok) break;
  } catch {}
  if (performance.now() - started > 10000) throw new Error("Production startup timed out");
  await new Promise((resolve) => setTimeout(resolve, 50));
}
const startupMs = performance.now() - started;
await new Promise((resolve) => setTimeout(resolve, 3000));
const memory = process.memoryUsage();
const requestMs = [];
for (let sample = 0; sample < 10; sample++) {
  const requestStarted = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/login`);
  await response.text();
  requestMs.push(performance.now() - requestStarted);
}
requestMs.sort((left, right) => left - right);
const database = new Database(":memory:");
const sqlite = database.prepare("SELECT sqlite_version() AS version").get();
database.close();
const packages = JSON.parse(readFileSync("package.json", "utf8"));
const measurements = {
  at: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  architecture: arch(),
  cpu: cpus()[0].model,
  startupMs,
  startupDefinition: "adapter import to successful login response; excludes OS process launch",
  idleAfterMs: 3000,
  memory,
  loginGetMs: { samples: requestMs, p50: requestMs[4], p95: requestMs[9] },
  sqlite,
  dependencies: packages.dependencies,
  devDependencies: packages.devDependencies,
  image: "not built",
};
const prefix = process.env.EVIDENCE_PREFIX ?? "";
writeFileSync(`docs/private/${prefix}measurements.json`, JSON.stringify(measurements, null, 2));
const files = [
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
  "playwright.config.ts",
  ".node-version",
  ".gitignore",
  ".env.example",
  "README.md",
  "DESIGN.md",
];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else files.push(path);
  }
}
for (const directory of ["src", "scripts", "tests", "static"]) collect(directory);
const manifest = files.sort().map((path) => ({
  path: path.replaceAll("\\", "/"),
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
}));
const revision = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
writeFileSync(
  `docs/private/${prefix}source-manifest.json`,
  JSON.stringify(
    {
      gitRevision: null,
      reason: "No Git repository at intake; no commit created",
      sourceSha256: revision,
      files: manifest,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    startupMs,
    idleRssMiB: memory.rss / 1048576,
    node: process.version,
    sqlite,
    sourceSha256: revision,
  }),
);
process.exit(0);
