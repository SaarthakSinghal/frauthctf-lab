import { hashPassword } from "better-auth/crypto";
import { getMigrations } from "better-auth/db/migration";
import Database from "better-sqlite3";
import { getAuth } from "../src/lib/server/auth.ts";
import { getWorkspaceDatabase } from "../src/lib/server/workspace.ts";

if (process.env.LOCAL_TEST !== "1" || !process.env.LOCAL_TEST_PASSWORD) {
  throw new Error("Explicit local test configuration required");
}
const origin = new URL(process.env.BETTER_AUTH_URL!);
if (!["127.0.0.1", "localhost"].includes(origin.hostname)) {
  throw new Error("Local seed requires loopback origin");
}
process.env.LOCAL_SEED = "1";
const auth = getAuth();
await (await getMigrations(auth.options)).runMigrations();
const database = new Database(process.env.SQLITE_PATH ?? "./data/local.sqlite");
const passwordHash = await hashPassword(process.env.LOCAL_TEST_PASSWORD);
const accounts = [
  {
    email: "analyst@cirque.test",
    legacy: "analyst@aster.test",
    name: "Alex Morgan",
    role: "analyst",
  },
  { email: "lead@cirque.test", legacy: "", name: "Priya Shah", role: "lead" },
] as const;
for (const account of accounts) {
  const existing = database
    .prepare("SELECT id FROM user WHERE email IN (?, ?)")
    .get(account.email, account.legacy) as { id: string } | undefined;
  if (!existing) {
    await auth.api.signUpEmail({
      body: {
        email: account.email,
        name: account.name,
        password: process.env.LOCAL_TEST_PASSWORD,
      },
    });
  } else {
    database.transaction(() => {
      database.prepare("DELETE FROM session WHERE userId = ?").run(existing.id);
      database.prepare("DELETE FROM mfa_used_totp WHERE user_id = ?").run(existing.id);
      database.prepare("DELETE FROM mfa_action_attempt WHERE user_id = ?").run(existing.id);
      database.prepare("DELETE FROM mfa_action_proof WHERE user_id = ?").run(existing.id);
      database.prepare("DELETE FROM mfa_pending_replacement WHERE user_id = ?").run(existing.id);
      database.prepare("DELETE FROM mfa_security_event WHERE user_id = ?").run(existing.id);
      database.prepare("DELETE FROM twoFactor WHERE userId = ?").run(existing.id);
      database
        .prepare(
          "UPDATE user SET email = ?, name = ?, emailVerified = 1, twoFactorEnabled = 0 WHERE id = ?",
        )
        .run(account.email, account.name, existing.id);
      database
        .prepare("UPDATE account SET password = ? WHERE userId = ? AND providerId = ?")
        .run(passwordHash, existing.id, "credential");
    })();
  }
  database.prepare("UPDATE user SET emailVerified = 1 WHERE email = ?").run(account.email);
  database
    .prepare("DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE email = ?)")
    .run(account.email);
}
const workspace = getWorkspaceDatabase();
if (
  workspace
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_reset_attempt'")
    .get()
) {
  workspace.exec("DELETE FROM auth_reset_attempt");
}
workspace.transaction(() => {
  workspace.exec(
    "DELETE FROM workspace_event; DELETE FROM workspace_incident; DELETE FROM workspace_project; DELETE FROM workspace_person; DELETE FROM workspace_member;",
  );
  for (const account of accounts) {
    const user = database.prepare("SELECT id FROM user WHERE email = ?").get(account.email) as {
      id: string;
    };
    workspace
      .prepare("INSERT INTO workspace_member (user_id, role) VALUES (?, ?)")
      .run(user.id, account.role);
  }
  const projects = [
    [
      "northstar",
      "Northstar API",
      "At risk",
      "Priya Shah",
      "Customer-facing events and webhook delivery. The team is tracing delayed dispatch after the Oct 19, 2026 deployment.",
      "2026-10-19T09:14:00Z",
    ],
    [
      "atlas",
      "Atlas migration",
      "On track",
      "Alex Morgan",
      "Move tenant configuration to the new control plane without interrupting existing workloads.",
      "2026-10-18T16:30:00Z",
    ],
    [
      "relay",
      "Relay observability",
      "On track",
      "Noah Kim",
      "Improve alert fidelity and incident handoffs for the operations rotation.",
      "2026-10-17T11:05:00Z",
    ],
  ];
  const insertProject = workspace.prepare(
    "INSERT INTO workspace_project VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const row of projects) insertProject.run(...row);
  const incidents = [
    [
      "INC-104",
      "Delayed webhook delivery",
      "Investigating",
      "High",
      "northstar",
      "Alex Morgan",
      "Webhook events are queued longer than the five-minute objective for a subset of EU tenants. Delivery is still progressing; no loss is confirmed.",
      "2026-10-19T09:14:00Z",
      "Internal review: the deployment changed queue concurrency. Customer identifiers and exact tenant impact are limited to response leads pending verification.",
    ],
    [
      "INC-103",
      "Elevated retry rate on ingest",
      "Monitoring",
      "Medium",
      "northstar",
      "Priya Shah",
      "Ingest retries rose after the morning release. Latency is stabilizing after a worker rollback.",
      "2026-10-19T08:42:00Z",
      null,
    ],
    [
      "INC-101",
      "Stale service health panel",
      "Resolved",
      "Low",
      "relay",
      "Noah Kim",
      "The health panel lagged live probes by eleven minutes; a cache invalidation fix is now deployed.",
      "2026-10-17T11:05:00Z",
      null,
    ],
  ];
  const insertIncident = workspace.prepare(
    "INSERT INTO workspace_incident VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const row of incidents) insertIncident.run(...row);
  const events = [
    [
      "INC-104",
      "update",
      "Alex Morgan",
      "Compared delivery latency by region; the EU queue is the only cohort still above objective.",
      "2026-10-19T09:14:00Z",
    ],
    [
      "INC-104",
      "update",
      "Priya Shah",
      "Paused the rollout and assigned queue-depth analysis to the on-call analyst.",
      "2026-10-19T08:55:00Z",
    ],
    [
      "INC-104",
      "opened",
      "Noah Kim",
      "Alert fired after sustained webhook delivery delay. No delivery failures observed.",
      "2026-10-19T08:31:00Z",
    ],
    [
      "INC-103",
      "update",
      "Priya Shah",
      "Rollback completed; retry rate is trending toward baseline.",
      "2026-10-19T08:42:00Z",
    ],
    [
      "INC-103",
      "opened",
      "Alex Morgan",
      "Investigating an elevated retry rate after the morning release.",
      "2026-10-19T07:56:00Z",
    ],
    [
      "INC-101",
      "resolved",
      "Noah Kim",
      "Panel cache invalidation deployed and verified against live probes.",
      "2026-10-17T11:05:00Z",
    ],
  ];
  const insertEvent = workspace.prepare(
    "INSERT INTO workspace_event (incident_id, kind, author, body, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const row of events) insertEvent.run(...row);
  const people = [
    [
      "alex",
      "Alex Morgan",
      "Operations analyst",
      "analyst@cirque.test",
      "Webhook delivery and Atlas migration",
    ],
    [
      "priya",
      "Priya Shah",
      "Response lead",
      "lead@cirque.test",
      "Incident command and Northstar API",
    ],
    [
      "noah",
      "Noah Kim",
      "Reliability engineer",
      "noah@cirque.test",
      "Relay observability and on-call tooling",
    ],
  ];
  const insertPerson = workspace.prepare("INSERT INTO workspace_person VALUES (?, ?, ?, ?, ?)");
  for (const row of people) insertPerson.run(...row);
})();
console.log(
  JSON.stringify({
    seed: "local-test",
    accounts: accounts.map((account) => account.email),
    projects: 3,
    incidents: 3,
    sqlite: database.prepare("SELECT sqlite_version() AS version").get(),
  }),
);
database.close();
process.exit(0);
