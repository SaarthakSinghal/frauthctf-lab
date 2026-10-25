import { getAuth } from "#lib/server/auth.js";
import { building } from "$app/env";
import type { Handle } from "@sveltejs/kit/hooks";
import { svelteKitHandler } from "better-auth/svelte-kit";

export const handle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);
  if (event.url.pathname === "/api/auth/request-password-reset")
    return new Response(null, { status: 404 });
  event.request.headers.set("x-frauth-client-ip", event.getClientAddress());
  if (event.url.pathname.startsWith("/api/auth/two-factor/") && event.request.method === "POST") {
    const body = await event.request
      .clone()
      .json()
      .catch(() => null);
    if (body?.trustDevice === true)
      return Response.json({ error: "Trusted devices are disabled" }, { status: 400 });
  }
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: event.request.headers });
  event.locals.user = session?.user ?? null;
  event.locals.session = session?.session ?? null;
  const response = await svelteKitHandler({ event, resolve, auth, building });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Referrer-Policy",
    event.url.pathname.startsWith("/reset-password/") ? "no-referrer" : "same-origin",
  );
  return response;
};
