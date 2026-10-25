import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const origin = process.env.BETTER_AUTH_URL ?? loadEnv(mode, process.cwd(), "").BETTER_AUTH_URL;
  if (!origin) throw new Error("BETTER_AUTH_URL is required to build Cirque");
  return {
    plugins: [
      sveltekit({
        adapter: adapter({ out: process.env.FRAUTH_TEST_BUILD === "1" ? "test-build" : "build" }),
        paths: { origin },
      }),
    ],
  };
});
