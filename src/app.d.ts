import type { AuthSession } from "./lib/server/auth.js";
declare global {
  namespace App {
    interface Locals {
      user: AuthSession["user"] | null;
      session: AuthSession["session"] | null;
    }
  }
}
export {};
