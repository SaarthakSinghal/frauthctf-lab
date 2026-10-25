import { redirect } from "@sveltejs/kit";
export function load({ locals }: { locals: App.Locals }) {
  if (locals.session) redirect(303, "/dashboard");
}
