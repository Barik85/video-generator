import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Script } from "../schemas.ts";
import { PermanentError, isPermanentHttpError } from "../util/retry.ts";
import type { LlmProvider, ScriptRequest } from "./types.ts";

const MODEL = process.env.REEL_LLM_MODEL ?? "claude-opus-5-5";
// USD per 1M tokens (input, output) — Claude Opus 5.5 list price.
const PRICE = { in: 4, out: 20 };

const SYSTEM = `You are a showrunner for vertical (9:16) AI-generated micro-drama.
You turn a short idea into a production-ready script for ONE short clip.

Hard rules — a validator checks them and rejects violations:
1. Dialogue lines that appear in quotes in the idea MUST be copied into "lines" character-for-character
   (same words, same punctuation, same language). Never paraphrase, translate, shorten or merge them.
   Each quoted fragment becomes exactly one line.
2. If the idea has no quoted dialogue, write 1–2 short natural lines (max ~14 words each) in the idea's language.
3. 1–3 shots. Each shot has at most one speaking character. Every line is used in exactly one shot.
4. Spoken time is ~2.5 words/second; the whole clip must fit the target length.
5. Shots that carry dialogue: framing that shows the speaker's face (medium close-up or closer), steady camera,
   minimal head movement — this is what makes lip-sync work.
6. "visual" never contains dialogue text or on-screen text/captions/logos.
7. "look" is a reusable, concrete description (age, face, hair, wardrobe colors) — it is pasted into every prompt.`;

export class AnthropicLlm implements LlmProvider {
  name = `anthropic:${MODEL}`;
  private client = new Anthropic();

  async writeScript(req: ScriptRequest) {
    const user = [
      `Idea: ${req.idea}`,
      `Target length: ${req.targetSeconds} seconds.`,
      req.quotedLines.length
        ? `Quoted lines that must appear verbatim:\n${req.quotedLines.map((l) => `- ${l}`).join("\n")}`
        : "No quoted dialogue in the idea.",
      req.feedback?.length ? `Your previous script was rejected:\n${req.feedback.map((f) => `- ${f}`).join("\n")}\nFix these issues.` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    let res;
    try {
      res = await this.client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        // If the request is ever declined by a safety classifier, let the API re-run it on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { format: betaZodOutputFormat(Script), effort: "medium" },
        system: SYSTEM,
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
