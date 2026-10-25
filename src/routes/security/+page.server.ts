import { redirect } from "@sveltejs/kit";
import { requireWorkspace } from "#lib/server/workspace.js";
export function load({ locals }: { locals: App.Locals }) {
  requireWorkspace(locals);
  redirect(303, "/profile");
}
