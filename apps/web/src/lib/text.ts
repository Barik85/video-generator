/** Lines quoted in the idea are spoken verbatim («...», "...", “...”). */
export function lockedLines(idea: string): string[] {
  return [...idea.matchAll(/«([^»]+)»|"([^"]+)"|“([^”]+)”/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim()).filter(Boolean);
}

/** Same normalization the QA uses: case and punctuation do not count. */
export const normalizeWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}'’]/gu, "");

export const words = (s: string) => s.split(/\s+/).filter((w) => normalizeWord(w) !== "");

export interface DiffToken {
  word: string;
  ok: boolean;
}

/**
 * Word-level LCS alignment between expected and heard text. Returns both sides with a per-word
 * flag: expected words not heard (deleted/substituted) and heard words not expected (inserted/
 * substituted) are `ok: false`.
 */
export function diffWords(expected: string, heard: string): { expected: DiffToken[]; heard: DiffToken[] } {
  const a = words(expected);
  const b = words(heard);
  const na = a.map(normalizeWord);
  const nb = b.map(normalizeWord);
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i]![j] = na[i] === nb[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const okA = new Array<boolean>(a.length).fill(false);
  const okB = new Array<boolean>(b.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (na[i] === nb[j]) {
      okA[i++] = true;
      okB[j++] = true;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return {
    expected: a.map((word, k) => ({ word, ok: okA[k]! })),
    heard: b.map((word, k) => ({ word, ok: okB[k]! })),
  };
}

/** Escapes a value for a double-quoted POSIX shell string. */
export const shellQuote = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
