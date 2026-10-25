import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  backupCodeStorage,
  consumeTotpStep,
  initializeMfaPolicy,
  matchBackupCode,
  matchingTotpStep,
} from "./mfa-policy.ts";
import { sendResetLink } from "./reset-mail.ts";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseURL)
    throw new Error("Auth environment is missing or invalid");
  const databasePath = resolve(process.env.SQLITE_PATH ?? "./data/local.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  initializeMfaPolicy(database);
  return betterAuth({
    appName: "Cirque",
    baseURL,
    secret,
    database,
    trustedOrigins: [baseURL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: process.env.LOCAL_SEED !== "1",
      minPasswordLength: 12,
      resetPasswordTokenExpiresIn: 20 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => sendResetLink(user.email, token),
    },
    session: { expiresIn: 60 * 60, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: new URL(baseURL).protocol === "https:",
      database: { validateSchema: process.env.LOCAL_SEED !== "1" },
      ipAddress: { ipAddressHeaders: ["x-frauth-client-ip"] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/request-password-reset": { window: 15 * 60, max: 3 },
        "/reset-password": { window: 15 * 60, max: 5 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/two-factor/disable" ||
          ctx.path === "/two-factor/generate-backup-codes" ||
          ctx.path === "/two-factor/get-totp-uri" ||
          ctx.path === "/two-factor/send-otp" ||
          ctx.path === "/two-factor/verify-otp"
        ) {
          throw new APIError("FORBIDDEN", { message: "Use Cirque Profile for this action" });
        }
        if (ctx.path === "/two-factor/enable") {
          const body = ctx.body as { method?: unknown; issuer?: unknown } | undefined;
          if (
            (body?.method !== undefined && body.method !== "totp") ||
            (body?.issuer !== undefined && body.issuer !== "Cirque")
          ) {
            throw new APIError("FORBIDDEN", {
              message: "Only Cirque authenticator setup is available",
            });
          }
          const session = await getSessionFromCtx(ctx);
          if (session?.user.twoFactorEnabled) {
            throw new APIError("FORBIDDEN", { message: "An authenticator is already enabled" });
          }
        }
        if (ctx.path !== "/two-factor/verify-totp" && ctx.path !== "/two-factor/verify-backup-code")
          return;
        const body = ctx.body as { code?: unknown } | undefined;
        if (typeof body?.code !== "string") return;
        const session = await getSessionFromCtx(ctx);
        let userId = session?.user.id;
        if (!userId) {
          const cookie = ctx.context.createAuthCookie("two_factor");
          const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
          if (challenge)
            userId = (await ctx.context.internalAdapter.findVerificationValue(challenge))?.value;
        }
        if (!userId) return;
        const factor = (await ctx.context.adapter.findOne({
          model: "twoFactor",
          where: [{ field: "userId", value: userId }],
        })) as { backupCodes: string; secret: string } | null;
        if (!factor) return;
        if (ctx.path === "/two-factor/verify-backup-code") {
          const match = matchBackupCode(factor.backupCodes, body.code);
          if (match) body.code = match;
          return;
        }
        const secret = await symmetricDecrypt({
          key: ctx.context.secretConfig,
          data: factor.secret,
        });
        const step = await matchingTotpStep(secret, body.code);
        if (step !== null && !consumeTotpStep(database, userId, step)) {
          throw new APIError("UNAUTHORIZED", {
            message: "This authenticator code has already been used",
          });
        }
      }),
    },
    plugins: [
      twoFactor({
        issuer: "Cirque",
        skipVerificationOnEnable: false,
        totpOptions: { period: 30, digits: 6 },
        backupCodeOptions: { storeBackupCodes: backupCodeStorage },
      }),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
export type AuthSession = ReturnType<typeof createAuth>["$Infer"]["Session"];
