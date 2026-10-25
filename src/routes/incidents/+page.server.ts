import { getIncidents, requireWorkspace } from "#lib/server/workspace.js";
export function load({ locals }: { locals: App.Locals }) {
  const { user, role } = requireWorkspace(locals);
  return {
    user: { name: user.name, email: user.email },
    role,
    incidents: getIncidents(),
  };
}
