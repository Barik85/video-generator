/**
 * Local Temporal server with the web UI, history kept in .temporal/dev.db: `npm run temporal:server`.
 * Same binary as `temporal server start-dev`, downloaded by the SDK, so no separate install is needed.
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import { TestWorkflowEnvironment } from "@temporalio/testing";

const dir = path.resolve(import.meta.dirname, "../../../.temporal");
mkdirSync(dir, { recursive: true });
const env = await TestWorkflowEnvironment.createLocal({
  server: { port: 7233, ui: true, uiPort: 8233, dbFilename: path.join(dir, "dev.db"), log: { format: "pretty", level: "warn" } },
});
console.log("Temporal dev server on localhost:7233, UI on http://localhost:8233 (Ctrl+C to stop)");
const stop = async () => {
  await env.teardown();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 60_000); // the server is a child process; keep this one alive until a signal
