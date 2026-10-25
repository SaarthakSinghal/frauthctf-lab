import { getIncidents, requireWorkspace } from "#lib/server/workspace.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals, url }) => {
  if (!/^\/(dashboard|incidents|projects|team|profile|security)(\/|$)/.test(url.pathname)) {
    return { shell: null };
  }
  const { user } = requireWorkspace(locals);
  return {
    shell: {
      openIncidents: getIncidents().filter((incident) => incident.status !== "Resolved").length,
      authenticatorEnabled: Boolean(user.twoFactorEnabled),
    },
  };
};
