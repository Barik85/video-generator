/** Long-running worker for an external Temporal server: `npm run temporal:worker`. */
import path from "node:path";
import { config } from "dotenv";
import { NativeConnection } from "@temporalio/worker";
import { createWorker, TASK_QUEUE } from "./runner.ts";

config({ path: path.resolve(import.meta.dirname, "../../../.env") });
const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const connection = await NativeConnection.connect({ address });
const worker = await createWorker(connection, process.env.TEMPORAL_NAMESPACE ?? "default");
console.log(`worker on ${address}, task queue "${TASK_QUEUE}"`);
await worker.run();
