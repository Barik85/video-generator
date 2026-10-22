// First import: the repo-root .env must be loaded before any module reads process.env.
import "./load-env.ts";
import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { PORT, RUNNER, RUNS_ROOT } from "./env.ts";

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`reel api on http://localhost:${info.port}  runs=${RUNS_ROOT}  runner=${RUNNER}`);
});
