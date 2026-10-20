import { Script } from "../schemas.ts";
import { PermanentError } from "../util/retry.ts";
import { containsExact, extractQuotedLines } from "../util/text.ts";
import type { StageContext } from "./context.ts";

const MAX_ATTEMPTS = 3;

/**
 * Idea → Script. The LLM is constrained twice: by the JSON schema (structure) and by
 * `validateScript` (semantics). Validation errors are fed back into the next attempt.
 */
export async function scriptStage(ctx: StageContext): Promise<Script> {
  const quotedLines = extractQuotedLines(ctx.input.idea);
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { script } = await ctx.paid("script", 0.1, () =>
      ctx.providers.llm.writeScript({ idea: ctx.input.idea, targetSeconds: ctx.input.targetSeconds, quotedLines, feedback }),
    );
    feedback = validateScript(script, quotedLines);
    if (feedback.length === 0) {
      await ctx.log("info", `script "${script.title}": ${script.shots.length} shots, ${script.lines.length} lines`);
      return script;
    }
    await ctx.log("validation.fail", `script attempt ${attempt} rejected: ${feedback.join("; ")}`, { feedback });
  }
  throw new PermanentError(`script failed validation ${MAX_ATTEMPTS} times: ${feedback.join("; ")}`);
}

export function validateScript(s: Script, quotedLines: string[]): string[] {
  const errs: string[] = [];
  const parsed = Script.safeParse(s);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

  const texts = s.lines.map((l) => l.text);
  for (const q of quotedLines) {
    if (!containsExact(texts, q)) errs.push(`quoted line must appear verbatim as one line: «${q}»`);
  }
  const charIds = new Set(s.characters.map((c) => c.id));
  const lineIds = new Set(s.lines.map((l) => l.id));
  for (const l of s.lines) if (!charIds.has(l.characterId)) errs.push(`line ${l.id} references unknown character ${l.characterId}`);

  const used = new Map<string, number>();
  for (const shot of s.shots) {
    const speakers = new Set<string>();
    for (const id of shot.lineIds) {
      if (!lineIds.has(id)) errs.push(`shot ${shot.id} references unknown line ${id}`);
      used.set(id, (used.get(id) ?? 0) + 1);
      const line = s.lines.find((l) => l.id === id);
      if (line) speakers.add(line.characterId);
    }
    if (speakers.size > 1) errs.push(`shot ${shot.id} has ${speakers.size} speakers; max 1`);
  }
  for (const id of lineIds) if (used.get(id) !== 1) errs.push(`line ${id} must be used in exactly one shot (used ${used.get(id) ?? 0})`);
  return errs;
}
