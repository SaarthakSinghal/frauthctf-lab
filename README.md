# Cirque local operations workspace

Private FrauthCTF development workspace. Cirque is a small incident and project collaboration product, not a participant export or a secure V0 release. Keep this directory, its Git history if added later, research, local databases, credentials, screenshots, and evidence private.

## Run locally

Use Node **24.22.0** and npm. On this Windows workspace, `./scripts/npm.ps1` selects the ignored project runtime. The test credentials below are deliberately local and public; do not deploy them.

```powershell
.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run setup:local
.\scripts\npm.ps1 run seed:local
.\scripts\npm.ps1 run check
.\scripts\npm.ps1 run build
.\scripts\npm.ps1 run start
```

Open `http://127.0.0.1:3000`. Local accounts share the password `local-test-only-passphrase`:

### Ubuntu preparation (not yet validated on Linux)

Use a clean private checkout and Node **24.22.0** with npm. The native `better-sqlite3` package may need `python3`, `make`, and `g++` if its prebuilt binary is unavailable. Keep the database directory writable by the app user and inaccessible to other local users; a restrictive umask also protects newly created test files.

```sh
node --version                    # expected: v24.22.0
umask 077
npm ci
npm run setup:local              # creates ignored .env.local with a random secret
npm run seed:local               # destructive local test accounts and workspace data
npm run check
npm run build
npm start                       # expected: Listening on http://127.0.0.1:3000
```

Run `npx playwright install chromium` once, then `npm test` for the local production-mode suite. With no other server on the configured loopback port, run `node --env-file=.env.local scripts/restart-smoke.mjs` to verify replacement across a real process restart using an isolated test database. These commands are prepared from cross-platform Node scripts; **they have not been run on Ubuntu**. Confirm native SQLite loading, case-sensitive imports, file permissions, origin/startup behavior, and the full suite there before claiming Linux support. `npm start` reads `.env.local`; choose an absolute writable `SQLITE_PATH` and the intended `BETTER_AUTH_URL` before building in a non-local environment. The build and runtime origins must match.

This local setup enables `LOCAL_TEST=1`, fixed test passwords, and file-based reset delivery. None belongs in a participant runtime. Production requires separately provisioned accounts, real per-user mail delivery, HTTPS origin, and private application data. If a future participant shell runs as the same OS user and can read SQLite or the auth secret, filesystem permissions alone do **not** isolate account data; deployment must prove a distinct process/user or container boundary and private mounts.

The production Node adapter embeds its canonical origin at build time. The build reads `BETTER_AUTH_URL` from the environment or `.env.local`, and `scripts/start.mjs` checks that it matches the runtime value. Deployment must set `BETTER_AUTH_URL` to its HTTPS public origin before building. Open the exact configured host and port in the browser; `localhost` and `127.0.0.1` are different origins.

- `analyst@cirque.test` — analyst, can read incidents and write notes; cannot open the response-lead report.
- `lead@cirque.test` — response lead; must enroll MFA before opening the restricted report.

Both seeded accounts start without MFA so enrollment can be exercised locally. A lead reaches Profile setup rather than the restricted report until MFA is confirmed.

`setup:local` creates a random auth secret in ignored `.env.local`. `seed:local` is destructive test setup: it resets these accounts' passwords and MFA, revokes their sessions, and replaces workspace records and notes. Back up `data/local.sqlite` before reseeding anything you want to keep. The seed recognizes the former `analyst@aster.test` account and renames it to `analyst@cirque.test`; the old email no longer signs in after that explicit step. Existing authenticator entries labelled Aster must be re-enrolled after reseeding. Without reseeding, an old account has no Cirque workspace role and is denied product access; do not silently deploy this local-data transition to real accounts.

If an existing local database contains the old reversible recovery-code format, startup stops rather than silently accepting it. After backing up the database, either run `./scripts/npm.ps1 run migrate:local-mfa` to retain existing saved codes as salted hashes, or run the destructive `seed:local` to reset test accounts and enroll again. Treat codes from a previously exposed database/auth secret as compromised and reseed instead. This transition is for private development data only.

Password reset uses a private file delivery adapter only when `LOCAL_TEST=1` and `BETTER_AUTH_URL` is loopback. On a local run, request a reset at `/forgot-password`, then read **only your account's** message from `data/test-mail/` using the SHA-256 hex digest of your lower-case email plus `.json` as the filename. Open its link in the same local browser; the link expires in 20 minutes and works once. The test-only directory and `.env.local` are ignored and must never be mounted in a participant pod. Deployment requires `CIRQUE_MAIL_MODE=webhook`, an HTTPS `CIRQUE_MAIL_ENDPOINT`, `CIRQUE_MAIL_KEY`, a real per-user mailbox, and an HTTPS `BETTER_AUTH_URL`; the relay accepts `{to,subject,text}` JSON with bearer authorization. No shared mailbox, reset-link logger, or test reset endpoint is shipped. Keep the relay and mailboxes outside participant shell access.

## Formatting

Install dprint 0.64.0, then run `dprint fmt` to format authored TypeScript, JavaScript, JSON, Markdown, CSS, HTML, Svelte, and SVG files. Run `dprint check` (or `./scripts/npm.ps1 run format:check`) before review. The pinned plugins in `dprint.json` provide the same rules on each machine. Generated output, local data, secrets, private evidence, and the npm lockfile are excluded. `.editorconfig` keeps editor whitespace consistent, including the manually formatted PowerShell helper. dprint does not format PowerShell or `.env` files; review those separately.

## Test

Install Chromium once with `./scripts/npm.ps1 exec playwright install chromium`. Run `./scripts/npm.ps1 test` after stopping any other server on port 3000. The test runner builds into an ignored `test-build/`, creates a fresh test-only SQLite database, runs production Chromium tests, and shuts down its server. It does not replace the regular `build/`. If port 3000 is occupied, use `$env:TEST_PORT='3100'; .\scripts\npm.ps1 test`.

The suite checks login, MFA enrollment/QR/manual key, atomic replay and recovery redemption, the lead gate, password reset, protected reads and writes, note persistence, cookies, origin checks, and layouts at 375/768/1280/1920 px. Screenshots and test observations are ignored under `docs/private/`; QR screenshots contain live test-factor material and must remain private.

## Security and release boundaries

Protected routes call `requireWorkspace` on the server. Password-only MFA-pending users have no usable session and cannot read product pages or write notes. The QR image is generated in the browser from Better Auth's enrollment URI; nothing is sent to a third-party QR service. Signup is disabled outside the explicit local seed process, and trusted devices are rejected server-side.

Cirque pins Better Auth 1.7.11. A narrow application hook adds atomic per-user TOTP step consumption; recovery codes use individually salted scrypt hashes and the plugin's compare-and-swap redemption. The allowed clock tolerance remains the installed plugin's previous/current/next 30-second steps. The response-lead report now requires confirmed MFA. See `docs/private/auth-hardening-decision.md` for the exact integration limits. The report remains a product access-control example, not a challenge. Do not add vulnerabilities or publish the source as a participant shell from this directory.

Profile authenticator disable and replacement require the current password plus a fresh code from the active factor (or an unused recovery code). Direct Better Auth password-only disable, code-regeneration, and current-key retrieval endpoints are blocked. A completed change revokes all sessions; replacement keeps the old factor active until the new code is confirmed and then issues new one-time recovery codes. The local security event is **not** an out-of-band notification. A user who has lost both factors needs a separately reviewed support process; password reset cannot disable MFA. See `docs/private/mfa-lifecycle-decision.md` for the lifecycle policy.

This is not a secure-V0 release. Before freezing V0, independently review the version-specific hook, repin to the applicable Node 24 security patch announced for 21 October 2026, and rerun clean install, SQLite load, typecheck, build, auth/browser, cookie, origin, reset-mail, and visual checks. HTTPS cookie behavior, production mail relay, and Linux deployment remain unqualified.
