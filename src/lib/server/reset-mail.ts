import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

export async function sendResetLink(email: string, token: string) {
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) throw new Error("Reset origin is not configured");
  const url = new URL(`/reset-password/${encodeURIComponent(token)}`, origin).toString();
  const message = {
    to: email,
    subject: "Reset your Cirque password",
    text: `Open this Cirque link to reset your password. It expires in 20 minutes and works once. If you did not request it, ignore this message.\n\n${url}`,
  };
  const mode =
    process.env.CIRQUE_MAIL_MODE ?? (process.env.LOCAL_TEST === "1" ? "file" : undefined);
  if (
    mode === "file" &&
    process.env.LOCAL_TEST === "1" &&
    ["127.0.0.1", "localhost"].includes(new URL(origin).hostname)
  ) {
    const directory = resolve(process.env.CIRQUE_MAIL_DIR ?? "./data/test-mail");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const name = createHash("sha256").update(email.toLowerCase()).digest("hex") + ".json";
    writeFileSync(join(directory, name), JSON.stringify(message), {
      mode: 0o600,
    });
    return;
  }
  if (mode === "webhook") {
    if (new URL(origin).protocol !== "https:")
      throw new Error("HTTPS reset origin is required for mail delivery");
    const endpoint = process.env.CIRQUE_MAIL_ENDPOINT;
    const key = process.env.CIRQUE_MAIL_KEY;
    if (!endpoint || new URL(endpoint).protocol !== "https:" || !key)
      throw new Error("Mail relay is not configured");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Mail relay rejected delivery");
    return;
  }
  throw new Error("Password-reset delivery is not configured");
}
