import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Script } from "../schemas.ts";
import { PermanentError, isPermanentHttpError } from "../util/retry.ts";
import { SCRIPT_SYSTEM, scriptUserMessage } from "./script-prompt.ts";
import type { LlmProvider, ScriptRequest } from "./types.ts";

const MODEL = process.env.REEL_LLM_MODEL ?? "claude-opus-5-5";
// USD per 1M tokens (input, output) — Claude Opus 5.5 list price.
const PRICE = { in: 4, out: 20 };

export class AnthropicLlm implements LlmProvider {
  name = `anthropic:${MODEL}`;
  private client = new Anthropic();

  async writeScript(req: ScriptRequest) {
    const user = scriptUserMessage(req);

    let res;
    try {
      res = await this.client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        // If the request is ever declined by a safety classifier, let the API re-run it on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { format: betaZodOutputFormat(Script), effort: "medium" },
        system: SCRIPT_SYSTEM,
        messages: [{ role: "user", content: user }],
      });
    } catch (err) {
      if (isPermanentHttpError(err)) throw new PermanentError(String(err));
      throw err;
    }

    const usd = (res.usage.input_tokens * PRICE.in + res.usage.output_tokens * PRICE.out) / 1e6;
    if (res.stop_reason === "refusal") throw new PermanentError(`LLM refused: ${res.stop_details?.explanation ?? "no details"}`);
    if (!res.parsed_output) throw new Error(`LLM returned no parsable script (stop_reason=${res.stop_reason})`);
    return { script: res.parsed_output, usd };
  }
}
