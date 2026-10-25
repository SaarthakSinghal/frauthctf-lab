import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { unflatten } from "devalue";

const origin = process.env.BETTER_AUTH_URL;
if (
  process.env.LOCAL_TEST !== "1" ||
  !process.env.LOCAL_TEST_PASSWORD ||
  !origin ||
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
) {
  throw new Error("Restart smoke requires explicit loopback LOCAL_TEST configuration");
}
try {
  await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) });
  throw new Error(`Stop the server at ${origin} before running restart smoke`);
} catch (failure) {
  if (failure instanceof Error && failure.message.startsWith("Stop the server")) throw failure;
}

mkdirSync("data", { recursive: true });
const environment = {
  ...process.env,
  SQLITE_PATH: resolve("data", `restart-smoke-${Date.now()}.sqlite`),
  HOST: "127.0.0.1",
  PORT: new URL(origin).port || "80",
};
const seed = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/seed-local.ts"], {
  env: environment,
  encoding: "utf8",
});
if (seed.status !== 0) throw new Error(`Restart smoke seed failed: ${seed.stderr}`);

function authenticatorCode(secret, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const digest = createHmac("sha1", key).update(counter).digest();
  const position = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function start() {
  const server = spawn(process.execPath, ["scripts/start.mjs"], {
    env: environment,
    stdio: "ignore",
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("Restart smoke server exited early");
    try {
      const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return server;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  server.kill();
  throw new Error("Restart smoke server did not become ready");
}

async function stop(server) {
  if (server.exitCode !== null) return;
  server.kill();
  await once(server, "exit");
}

function client() {
  const cookies = new Map();
  return async (path, body, form = false) => {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined
          ? {}
          : {
              Origin: origin,
              "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
              ...(form ? { "x-sveltekit-action": "true" } : {}),
            }),
        Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      },
      body:
        body === undefined ? undefined : form ? new URLSearchParams(body) : JSON.stringify(body),
      redirect: "manual",
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const position = pair.indexOf("=");
      if (position > 0) cookies.set(pair.slice(0, position), pair.slice(position + 1));
    }
    return response;
  };
}

async function actionData(response) {
  if (response.status !== 200) throw new Error("MFA action failed");
  const result = await response.json();
  if (result.type !== "success") throw new Error("MFA action was not successful");
  return unflatten(JSON.parse(result.data));
}

let server;
try {
  server = await start();
  const first = client();
  const credentials = {
    email: "analyst@cirque.test",
    password: process.env.LOCAL_TEST_PASSWORD,
  };
  if ((await first("/api/auth/sign-in/email", credentials)).status !== 200)
    throw new Error("Initial sign-in failed");
  const enrollment = await first("/api/auth/two-factor/enable", {
    password: credentials.password,
  });
  if (enrollment.status !== 200) throw new Error("Initial enrollment failed");
  const { totpURI, backupCodes } = await enrollment.json();
  const secret = new URL(totpURI).searchParams.get("secret");
  if (
    !secret ||
    (await first("/api/auth/two-factor/verify-totp", { code: authenticatorCode(secret) }))
      .status !== 200
  ) {
    throw new Error("Initial authenticator confirmation failed");
  }
  const proof = await actionData(
    await first(
      "/profile?/proveMfa",
      { action: "replace", password: credentials.password, code: backupCodes[0] },
      true,
    ),
  );
  const pending = await actionData(
    await first("/profile?/beginReplacement", { proof: proof.proof }, true),
  );
  const replacementSecret = new URL(pending.replacementURI).searchParams.get("secret");
  if (!replacementSecret || replacementSecret === secret)
    throw new Error("Replacement key was not fresh");
  const completed = await actionData(
    await first(
      "/profile?/confirmReplacement",
      { code: authenticatorCode(replacementSecret) },
      true,
    ),
  );
  if (completed.recoveryCodes?.length !== 10)
    throw new Error("Replacement recovery codes were not issued");
  await stop(server);
  server = await start();
  const second = client();
  const signIn = await second("/api/auth/sign-in/email", credentials);
  if (signIn.status !== 200 || !(await signIn.json()).twoFactorRedirect)
    throw new Error("Post-restart password challenge failed");
  if (
    (await second("/api/auth/two-factor/verify-backup-code", { code: backupCodes[1] })).status !==
    401
  ) {
    throw new Error("Old recovery code worked after replacement and restart");
  }
  if (
    (
      await second("/api/auth/two-factor/verify-backup-code", {
        code: completed.recoveryCodes[0],
      })
    ).status !== 200
  ) {
    throw new Error("Post-restart replacement recovery challenge failed");
  }
  if ((await second("/dashboard")).status !== 200)
    throw new Error("Post-restart authenticated dashboard failed");
  if ((await second("/api/auth/sign-out", {})).status !== 200)
    throw new Error("Post-restart sign-out failed");
  const freshSignIn = await second("/api/auth/sign-in/email", credentials);
  if (freshSignIn.status !== 200 || !(await freshSignIn.json()).twoFactorRedirect)
    throw new Error("Post-restart TOTP sign-in challenge failed");
  if (
    (
      await second("/api/auth/two-factor/verify-totp", {
        code: authenticatorCode(replacementSecret, 1),
      })
    ).status !== 200
  ) {
    throw new Error("New authenticator did not work after restart");
  }
  if ((await second("/dashboard")).status !== 200)
    throw new Error("New authenticator session could not open dashboard");
  console.log(
    JSON.stringify({
      replacement: "passed",
      restart: "passed",
      recoveryLogin: "passed",
      totpLogin: "passed",
    }),
  );
} finally {
  if (server) await stop(server);
}
