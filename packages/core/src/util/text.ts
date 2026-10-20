/**
 * Verbatim checks. "Verbatim" here means: the same words in the same order once case,
 * punctuation and whitespace are ignored — that is all ASR can tell us reliably.
 */

/** Lines the user put in quotes in the idea: these must survive into the script untouched. */
export function extractQuotedLines(idea: string): string[] {
  const out: string[] = [];
  const re = /«([^»]+)»|“([^”]+)”|"([^"]+)"|„([^“”]+)[“”]/g;
  for (const m of idea.matchAll(re)) {
    const s = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (s) out.push(s);
  }
  return out;
}

export function normalizeWords(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’'`ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/(^|\s)['-]+|['-]+(\s|$)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word error rate via Levenshtein over words. 0 = identical. */
export function wordErrorRate(expected: string, heard: string): number {
  const a = normalizeWords(expected);
  const b = normalizeWords(heard);
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  return d[a.length]![b.length]! / a.length;
}

/** Whether `needle` occurs in `haystack` exactly (modulo surrounding whitespace). Used for the script contract. */
export function containsExact(haystack: string[], needle: string): boolean {
  return haystack.some((h) => h.trim() === needle.trim());
}
