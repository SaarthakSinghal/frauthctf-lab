import { getIncidents, getProjects, requireWorkspace } from "#lib/server/workspace.js";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ locals, params }) => {
  const { user, role } = requireWorkspace(locals);
  const project = getProjects().find((item) => item.id === params.id);
  if (!project) error(404, "Project not found");
  return {
    user: { name: user.name, email: user.email },
    role,
    project,
    incidents: getIncidents().filter((item) => item.projectId === params.id),
  };
};
