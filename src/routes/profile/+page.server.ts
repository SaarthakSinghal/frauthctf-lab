import { fail, redirect } from "@sveltejs/kit";
import { getAuth } from "#lib/server/auth.js";
import {
  allowMfaActionAttempt,
  beginReplacement,
  cancelReplacement,
  confirmReplacement,
  disableMfa,
  issueMfaProof,
  pendingReplacement,
  type MfaAction,
} from "#lib/server/mfa-lifecycle.js";
import { requireWorkspace, getWorkspaceDatabase } from "#lib/server/workspace.js";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const { user, role } = requireWorkspace(locals);
  const factor = getWorkspaceDatabase()
    .prepare("SELECT verified FROM twoFactor WHERE userId = ?")
    .get(user.id) as { verified: number } | undefined;
  return {
    user: { name: user.name, email: user.email },
    role,
    twoFactorEnabled: user.twoFactorEnabled,
    enrollmentPending: Boolean(factor && !factor.verified),
    replacementURI: await pendingReplacement(user.id, locals.session!.token, user.email),
    setupRequired:
      role === "lead" && !user.twoFactorEnabled && url.searchParams.get("setup") === "required",
    replacementRequired: role === "lead" && url.searchParams.get("setup") === "replace",
  };
};

export const actions: Actions = {
  proveMfa: async ({ locals, request }) => {
    const { user } = requireWorkspace(locals);
    const input = await request.formData();
    const action = input.get("action");
    const password = input.get("password");
    const code = input.get("code");
    if (
      (action !== "disable" && action !== "replace") ||
      typeof password !== "string" ||
      password.length > 1024 ||
      typeof code !== "string" ||
      code.length > 64 ||
      !allowMfaActionAttempt(user.id)
    ) {
      return fail(400, { message: "Unable to verify. Check your details or try again later." });
    }
    try {
      await getAuth().api.verifyPassword({ headers: request.headers, body: { password } });
    } catch {
      return fail(400, { message: "Unable to verify. Check your details or try again later." });
    }
    const proof = await issueMfaProof(user.id, locals.session!.token, action as MfaAction, code);
    if (!proof) return fail(400, { message: "Unable to verify. Use a fresh code and try again." });
    return { action, proof };
  },
  disableMfa: async ({ locals, request }) => {
    const { user } = requireWorkspace(locals);
    const proof = (await request.formData()).get("proof");
    if (typeof proof !== "string" || !disableMfa(user.id, locals.session!.token, proof)) {
      return fail(400, { message: "Confirmation expired or was already used. Start again." });
    }
    redirect(303, "/login?mfa=disabled");
  },
  beginReplacement: async ({ locals, request }) => {
    const { user } = requireWorkspace(locals);
    const proof = (await request.formData()).get("proof");
    if (typeof proof !== "string")
      return fail(400, { message: "Confirmation expired or was already used. Start again." });
    const uri = await beginReplacement(user.id, locals.session!.token, proof, user.email);
    if (!uri) return fail(400, { message: "Unable to start replacement. Start again." });
    return { replacementURI: uri };
  },
  cancelReplacement: async ({ locals }) => {
    const { user } = requireWorkspace(locals);
    if (!cancelReplacement(user.id, locals.session!.token))
      return fail(400, { message: "Replacement is no longer pending." });
    return { cancelled: true };
  },
  confirmReplacement: async ({ locals, request }) => {
    const { user } = requireWorkspace(locals);
    if (!allowMfaActionAttempt(user.id))
      return fail(429, { message: "Too many attempts. Try again later." });
    const code = (await request.formData()).get("code");
    if (typeof code !== "string" || !/^\d{6}$/.test(code))
      return fail(400, { message: "Enter a six-digit code from the new authenticator." });
    const recoveryCodes = await confirmReplacement(user.id, locals.session!.token, code);
    if (!recoveryCodes) return fail(400, { message: "Code not accepted. Try a fresh code." });
    return { recoveryCodes };
  },
};
