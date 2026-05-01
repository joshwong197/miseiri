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

// Common business-name abbreviations expanded to their full forms before
// scoring. Both query and candidate get the same treatment, so identical
// shapes stay identical. Tradeoff: a customer who really did mean
// "Communications" with the token "comm" will score worse than against an
// actual "Communications Ltd" candidate — but that case is rarer than the
// truncation case (Comm → Commercial), and any near-miss still falls
// through to needs_review with candidates surfaced for the user.
const ABBREVIATIONS: Record<string, string> = {
  comm: "commercial",
  intl: "international",
  mfg: "manufacturing",
  mgmt: "management",
  bros: "brothers",
  hldgs: "holdings",
  grp: "group",
  natl: "national",
  svcs: "services",
};

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
    .filter((t) => !COMMON_SUFFIXES.includes(t))
    .map((t) => ABBREVIATIONS[t] ?? t);

  return tokens.join(" ");
}

export function expandAbbreviations(name: string): string {
  if (!name) return "";
  const base = normalize(name);
  return base
    .split(" ")
    .map((t) => ABBREVIATIONS[t] ?? t)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(name: string): string[] {
  return normalizeForCompare(name).split(" ").filter(Boolean);
}
