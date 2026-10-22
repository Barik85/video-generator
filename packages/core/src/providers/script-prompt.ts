import type { ScriptRequest } from "./types.ts";

/** Shared by every LLM provider so the script contract does not depend on which API carries it. */
export const SCRIPT_SYSTEM = `You are a showrunner for vertical (9:16) AI-generated micro-drama.
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

export function scriptUserMessage(req: ScriptRequest): string {
  return [
    `Idea: ${req.idea}`,
    `Target length: ${req.targetSeconds} seconds.`,
    req.quotedLines.length
      ? `Quoted lines that must appear verbatim:\n${req.quotedLines.map((l) => `- ${l}`).join("\n")}`
      : "No quoted dialogue in the idea.",
    req.review?.notes.length
      ? [
          req.review.previous ? `A human reviewer read this script:\n${JSON.stringify(req.review.previous)}` : "A human reviewer read your script.",
          `Their notes, oldest first:\n${req.review.notes.map((n) => `- ${n}`).join("\n")}`,
          `Rewrite the script to address the notes. Keep what they did not ask to change. The hard rules still apply.`,
        ].join("\n")
      : "",
    req.feedback?.length ? `Your previous script was rejected:\n${req.feedback.map((f) => `- ${f}`).join("\n")}\nFix these issues.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
