import { getAuth } from "#lib/server/auth.js";
import { allowResetAttempt } from "#lib/server/reset-attempts.js";
import { fail } from "@sveltejs/kit";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ request, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return fail(400, { invalid: true });
    }
    if (!allowResetAttempt("request", getClientAddress())) return fail(429, { limited: true });
    try {
      await getAuth().api.requestPasswordReset({
        body: {
          email,
          redirectTo: `${process.env.BETTER_AUTH_URL}/reset-password`,
        },
      });
    } catch {
      console.error("Password-reset delivery could not be completed");
    }
    return { submitted: true };
  },
};
