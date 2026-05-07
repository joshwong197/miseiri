// Additional similarity primitives used by the Miseiri Logic scorer.
// Spaceless trigram Dice, Jaro-Winkler, and asymmetric token containment.
// Pure, no I/O, no deps. Safe to call in a browser hot loop.

import { normalizeForCompare, tokens } from "./normalize";

/**
 * Sørensen-Dice on character trigrams of the input strings with all
 * whitespace stripped. Order-insensitive at the trigram level, but
 * because trigrams overlap, character order within local windows is
 * preserved.
 *
 * Solves the boundary-moves class — "AN" vs "A N" collapse to the same
 * spaceless string and score 1.0. Also tolerates one-character typos
 * gracefully because most trigrams remain shared.
 */
export function spacelessTrigramDice(a: string, b: string): number {
  const sa = normalizeForCompare(a).replace(/\s+/g, "");
  const sb = normalizeForCompare(b).replace(/\s+/g, "");
  if (!sa && !sb) return 0;
  if (sa === sb) return 1;
  if (sa.length < 3 || sb.length < 3) {
    // Too short for trigrams — fall back to substring containment.
    return sa.includes(sb) || sb.includes(sa) ? 0.8 : 0;
  }
  const ta = trigramSet(sa);
  const tb = trigramSet(sb);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

function trigramSet(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
  return out;
}

/**
 * Jaro-Winkler similarity with prefix scaling p=0.1 (the standard
 * value). Run on `normalizeForCompare`-cleaned forms so suffixes and
 * stop-words don't dominate the prefix bonus.
 *
 * Strong signal for character-level typos that preserve the prefix
 * ("Fontera" ↔ "Fonterra"). Weak when the front of the string is what
 * differs — the trigram and token signals cover that case.
 */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const s1 = normalizeForCompare(a);
  const s2 = normalizeForCompare(b);
  if (!s1 && !s2) return 0;
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const m1 = new Array(s1.length).fill(false);
  const m2 = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (m2[j]) continue;
      if (s1[i] !== s2[j]) continue;
      m1[i] = true;
      m2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro =
    (m / s1.length + m / s2.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * prefixScale * (1 - jaro);
}

/**
 * Asymmetric: fraction of query tokens that appear (as a substring) in
 * any candidate token. Designed for the truncation case — query
 * "Acme Industries" against candidate "Acme Industries Holdings" is 1.0
 * because every query token appears in the candidate.
 *
 * Note: substring (not exact equality) so plurals and short prefixes
 * still count ("industry" is contained in "industries").
 */
export function tokenContainment(query: string, candidate: string): number {
  const qt = tokens(query);
  const ct = tokens(candidate);
  if (qt.length === 0 || ct.length === 0) return 0;
  let contained = 0;
  for (const q of qt) {
    if (ct.some((c) => c.includes(q))) contained++;
  }
  return contained / qt.length;
}
