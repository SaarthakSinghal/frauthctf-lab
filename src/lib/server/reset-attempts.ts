import { createHash } from "node:crypto";
import { getWorkspaceDatabase } from "./workspace.js";

export function allowResetAttempt(kind: "request" | "token", address: string) {
  const database = getWorkspaceDatabase();
  database.exec(
    "CREATE TABLE IF NOT EXISTS auth_reset_attempt (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)",
  );
  const key = createHash("sha256").update(`${kind}:${address}`).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  const start = now - 15 * 60;
  database
    .prepare(`
    INSERT INTO auth_reset_attempt (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END,
      count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END
  `)
    .run(key, now, start, start);
  const row = database.prepare("SELECT count FROM auth_reset_attempt WHERE key = ?").get(key) as {
    count: number;
  };
  return row.count <= (kind === "request" ? 3 : 5);
}
