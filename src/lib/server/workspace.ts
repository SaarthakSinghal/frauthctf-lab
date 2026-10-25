import { error, redirect } from "@sveltejs/kit";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Role = "analyst" | "lead";
export type Incident = {
  id: string;
  title: string;
  status: string;
  severity: string;
  projectId: string;
  projectName: string;
  owner: string;
  summary: string;
  updatedAt: string;
};
export type Project = {
  id: string;
  name: string;
  status: string;
  owner: string;
  summary: string;
  updatedAt: string;
};
export type TimelineItem = {
  id: number;
  kind: string;
  author: string;
  body: string;
  createdAt: string;
};

let instance: Database.Database | undefined;
export function getWorkspaceDatabase() {
  if (instance) return instance;
  const path = resolve(process.env.SQLITE_PATH ?? "./data/local.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS workspace_member (user_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('analyst', 'lead')));
    CREATE TABLE IF NOT EXISTS workspace_project (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, owner TEXT NOT NULL, summary TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_incident (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES workspace_project(id), owner TEXT NOT NULL, summary TEXT NOT NULL, updated_at TEXT NOT NULL, restricted_report TEXT);
    CREATE TABLE IF NOT EXISTS workspace_event (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id TEXT NOT NULL REFERENCES workspace_incident(id), kind TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_person (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, email TEXT NOT NULL, focus TEXT NOT NULL);
  `);
  return (instance = database);
}

export function requireWorkspace(locals: App.Locals) {
  if (!locals.user || !locals.session) redirect(303, "/login");
  const member = getWorkspaceDatabase()
    .prepare("SELECT role FROM workspace_member WHERE user_id = ?")
    .get(locals.user.id) as { role: Role } | undefined;
  if (!member) error(403, "Workspace access has not been assigned");
  return { user: locals.user, role: member.role };
}

export function hasVerifiedAuthenticator(userId: string) {
  const factor = getWorkspaceDatabase()
    .prepare("SELECT verified FROM twoFactor WHERE userId = ?")
    .get(userId) as { verified: number } | undefined;
  return factor?.verified === 1;
}

export function hasPendingReplacement(userId: string) {
  return Boolean(
    getWorkspaceDatabase()
      .prepare("SELECT 1 FROM mfa_pending_replacement WHERE user_id = ? AND expires_at > ?")
      .get(userId, Date.now()),
  );
}

export function getIncidents() {
  return getWorkspaceDatabase()
    .prepare(
      `SELECT i.id, i.title, i.status, i.severity, i.project_id AS projectId, p.name AS projectName, i.owner, i.summary, i.updated_at AS updatedAt FROM workspace_incident i JOIN workspace_project p ON p.id = i.project_id ORDER BY i.updated_at DESC`,
    )
    .all() as Incident[];
}

export function getIncident(id: string) {
  return getWorkspaceDatabase()
    .prepare(
      `SELECT i.id, i.title, i.status, i.severity, i.project_id AS projectId, p.name AS projectName, i.owner, i.summary, i.updated_at AS updatedAt FROM workspace_incident i JOIN workspace_project p ON p.id = i.project_id WHERE i.id = ?`,
    )
    .get(id) as Incident | undefined;
}

export function getRestrictedReport(id: string) {
  return getWorkspaceDatabase()
    .prepare("SELECT restricted_report AS report FROM workspace_incident WHERE id = ?")
    .get(id) as { report: string | null } | undefined;
}

export function getProjects() {
  return getWorkspaceDatabase()
    .prepare(
      "SELECT id, name, status, owner, summary, updated_at AS updatedAt FROM workspace_project ORDER BY name",
    )
    .all() as Project[];
}

export function getTimeline(incidentId: string) {
  return getWorkspaceDatabase()
    .prepare(
      "SELECT id, kind, author, body, created_at AS createdAt FROM workspace_event WHERE incident_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(incidentId) as TimelineItem[];
}

export function getPeople() {
  return getWorkspaceDatabase()
    .prepare("SELECT id, name, title, email, focus FROM workspace_person ORDER BY name")
    .all() as {
    id: string;
    name: string;
    title: string;
    email: string;
    focus: string;
  }[];
}
