// Name normalization for matching. Pure, no side effects.
//
// We strip the bits that vary between systems (case, punctuation,
// suffixes like "Limited") so similarity scoring focuses on the
// distinctive parts of the name.

const COMMON_SUFFIXES = [
  "limited",
  "ltd",
  "incorporated",
  "inc",
  "company",
  "co",
  "corporation",
  "corp",
  "trust",
];

const STOP_WORDS = new Set(["the", "and", "&"]);

export function normalize(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.,/#!$%^*;:{}=\-_`~()]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Aggressive normalization for similarity comparison: strip suffixes
 * and stop-words after the basic clean. Used by the matcher only —
 * never surface the result to the user.
 */
export function normalizeForCompare(name: string): string {
  const base = normalize(name);
  if (!base) return "";

  const tokens = base
    .split(" ")
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t))
    .filter((t) => !COMMON_SUFFIXES.includes(t));

  return tokens.join(" ");
}

export function tokens(name: string): string[] {
  return normalizeForCompare(name).split(" ").filter(Boolean);
}
