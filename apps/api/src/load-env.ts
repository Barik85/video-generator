import path from "node:path";
import { config } from "dotenv";

// Provider keys (OPENROUTER_API_KEY, …) live in <repo>/.env, the same file the CLI and worker read.
config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
