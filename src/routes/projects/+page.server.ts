import { getIncidents, getProjects, requireWorkspace } from "#lib/server/workspace.js";
export function load({ locals }: { locals: App.Locals }) {
  const { user, role } = requireWorkspace(locals);
  const incidents = getIncidents();
  return {
    user: { name: user.name, email: user.email },
    role,
    projects: getProjects().map((project) => ({
      ...project,
      openIncidents: incidents.filter(
        (incident) => incident.projectId === project.id && incident.status !== "Resolved",
      ).length,
    })),
  };
}
