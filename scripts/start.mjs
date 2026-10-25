const origin = process.env.BETTER_AUTH_URL;
if (!origin) throw new Error("BETTER_AUTH_URL is required");
if (process.env.ORIGIN && process.env.ORIGIN !== origin)
  throw new Error("ORIGIN must match BETTER_AUTH_URL");
const { origin: builtOrigin } = await import("../build/adapter-node.js");
if (builtOrigin !== origin)
  throw new Error("The build origin does not match BETTER_AUTH_URL. Run npm run build again.");
process.env.ORIGIN = origin;
await import("../build/index.js");
