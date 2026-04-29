// Similarity primitives. Pure, deterministic, no I/O.

import { tokens, normalizeForCompare } from "./normalize";

/** Jaccard index over token sets. Order- and duplicate-insensitive. */
export function jaccard(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 && tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const unionSize = ta.size + tb.size - intersection;
  return unionSize === 0 ? 0 : intersection / unionSize;
}

/**
 * Fuzzy Jaccard — like jaccard, but a query token "matches" a candidate
 * token if their per-token Levenshtein ratio is above the threshold.
 * Catches typos like "Fontera" ↔ "Fonterra" that exact Jaccard misses.
 */
export function fuzzyJaccard(a: string, b: string, threshold = 0.8): number {
  const ta = [...new Set(tokens(a))];
  const tb = [...new Set(tokens(b))];
  if (ta.length === 0 && tb.length === 0) return 0;

  let matched = 0;
  const usedB = new Set<number>();
  for (const tok of ta) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < tb.length; i++) {
      if (usedB.has(i)) continue;
      const candTok = tb[i];
      if (tok === candTok) {
        bestIdx = i;
        bestScore = 1;
        break;
      }
      const max = Math.max(tok.length, candTok.length);
      const r = max === 0 ? 0 : 1 - levenshtein(tok, candTok) / max;
      if (r > bestScore && r >= threshold) {
        bestScore = r;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      matched++;
      usedB.add(bestIdx);
    }
  }
  const unionSize = ta.length + tb.length - matched;
  return unionSize === 0 ? 0 : matched / unionSize;
}

/**
 * Levenshtein distance between two strings, iterative DP.
 * O(m*n) time, O(min(m,n)) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length < b.length) [a, b] = [b, a];

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Levenshtein normalised to [0, 1] where 1 is identical. */
export function levenshteinRatio(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na && !nb) return 0;
  const max = Math.max(na.length, nb.length);
  if (max === 0) return 0;
  return 1 - levenshtein(na, nb) / max;
}

/**
 * Did one name's first token start the other's first token? Catches
 * cases like "ABC" vs "ABC Limited" (where suffix-stripping might not
 * fully normalize because "ABC" alone has no suffix).
 */
export function tokenPrefixMatch(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const ha = ta[0];
  const hb = tb[0];
  if (ha === hb) return 1;
  if (ha.startsWith(hb) || hb.startsWith(ha)) return 0.7;
  // Near-prefix tolerance for typos in the leading word
  // ("fontera" ↔ "fonterra"). Only counts above an 0.8 ratio.
  const max = Math.max(ha.length, hb.length);
  if (max < 4) return 0;
  const r = 1 - levenshtein(ha, hb) / max;
  return r >= 0.8 ? r : 0;
}
