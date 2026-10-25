import {
  getIncident,
  getRestrictedReport,
  hasVerifiedAuthenticator,
  hasPendingReplacement,
  requireWorkspace,
} from "#lib/server/workspace.js";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ locals, params }) => {
  const { user, role } = requireWorkspace(locals);
  if (role !== "lead") error(403, "Response lead access required");
  if (hasPendingReplacement(user.id)) redirect(303, "/profile?setup=replace");
  if (!user.twoFactorEnabled || !hasVerifiedAuthenticator(user.id))
    redirect(303, "/profile?setup=required");
  const incident = getIncident(params.id);
  const report = getRestrictedReport(params.id)?.report;
  if (!incident || !report) error(404, "Report not found");
  return {
    user: { name: user.name, email: user.email },
    role,
    incident,
    report,
  };
};
