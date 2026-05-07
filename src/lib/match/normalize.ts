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
  // Geographic expansions. Values may be multi-word — they get re-split
  // by the token-join step downstream, so "nz" → "new zealand" becomes
  // two tokens, allowing jaccard to count both halves of the match.
  nz: "new zealand",
  chch: "christchurch",
  akl: "auckland",
  wgtn: "wellington",
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

// Words customers tack onto entity names in ledgers (e.g. "Carters
// Christchurch office", "Smith Wellington branch", "Acme HQ"). They
// never appear in legal names registered with NZBN, so removing them
// before search both surfaces the right candidate and stops them from
// dragging the score down. Stripped from query and candidate alike.
const QUERY_JUNK_WORDS = new Set([
  "office",
  "offices",
  "branch",
  "branches",
  "warehouse",
  "warehouses",
  "store",
  "stores",
  "shop",
  "shops",
  "depot",
  "depots",
  "outlet",
  "outlets",
  "headquarters",
  "hq",
  "division",
  "div",
  "location",
  "site",
]);

/**
 * Strip role/location descriptors and bare numeric tokens from a query
 * string. Used in the name-search path to clean up customer ledgers
 * before talking to NZBN.
 *
 * Returns the stripped string, or the input itself if stripping would
 * leave nothing useful (so we never send an empty query).
 */
export function stripQueryJunk(name: string): string {
  if (!name) return "";
  const base = normalize(name);
  if (!base) return "";
  const stripped = base
    .split(" ")
    .filter((t) => t.length > 0 && !QUERY_JUNK_WORDS.has(t) && !/^\d+$/.test(t))
    .join(" ");
  return stripped.length === 0 ? base : stripped;
}
