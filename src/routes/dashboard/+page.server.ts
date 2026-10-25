import { getIncidents, getProjects, getTimeline, requireWorkspace } from "#lib/server/workspace.js";
export function load({ locals }: { locals: App.Locals }) {
  const { user, role } = requireWorkspace(locals);
  const incidents = getIncidents();
  const projects = getProjects();
  return {
    user: {
      name: user.name,
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
    },
    role,
    incidents: incidents.slice(0, 3),
    activeCount: incidents.filter((incident) => incident.status !== "Resolved").length,
    atRiskCount: projects.filter((project) => project.status === "At risk").length,
    recentActivity: incidents.length ? getTimeline(incidents[0].id).slice(0, 2) : [],
  };
}
