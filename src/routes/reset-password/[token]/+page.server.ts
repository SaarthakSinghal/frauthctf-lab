import { getAuth } from "#lib/server/auth.js";
import { getWorkspaceDatabase } from "#lib/server/workspace.js";
import { allowResetAttempt } from "#lib/server/reset-attempts.js";
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const verification = getWorkspaceDatabase()
    .prepare("SELECT expiresAt FROM verification WHERE identifier = ?")
    .get(`reset-password:${params.token}`) as { expiresAt: string } | undefined;
  return {
    valid: Boolean(verification && new Date(verification.expiresAt).getTime() > Date.now()),
  };
};

export const actions: Actions = {
  default: async ({ request, params, getClientAddress }) => {
    if (!allowResetAttempt("token", getClientAddress())) return fail(429, { limited: true });
    const form = await request.formData();
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password.length < 12 || password !== confirmation) return fail(400, { mismatch: true });
    try {
      await getAuth().api.resetPassword({
        body: { token: params.token, newPassword: password },
      });
      return { complete: true };
    } catch {
      return fail(400, { invalid: true });
    }
  },
};
