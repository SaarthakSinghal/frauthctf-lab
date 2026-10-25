import {
  getIncident,
  getTimeline,
  getWorkspaceDatabase,
  requireWorkspace,
} from "#lib/server/workspace.js";
import { error, fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, params }) => {
  const { user, role } = requireWorkspace(locals);
  const incident = getIncident(params.id);
  if (!incident) error(404, "Incident not found");
  return {
    user: { name: user.name, email: user.email },
    role,
    incident,
    timeline: getTimeline(params.id),
  };
};

export const actions: Actions = {
  default: async ({ locals, params, request }) => {
    const { user } = requireWorkspace(locals);
    if (!getIncident(params.id)) error(404, "Incident not found");
    const body = String((await request.formData()).get("note") ?? "").trim();
    if (body.length < 8 || body.length > 1000) {
      return fail(400, {
        message: "Write a note between 8 and 1000 characters.",
        note: body,
      });
    }
    const database = getWorkspaceDatabase();
    database.transaction(() => {
      const now = new Date().toISOString();
      database
        .prepare(
          "INSERT INTO workspace_event (incident_id, kind, author, body, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(params.id, "note", user.name, body, now);
      database
        .prepare("UPDATE workspace_incident SET updated_at = ? WHERE id = ?")
        .run(now, params.id);
    })();
    return { saved: true };
  },
};
