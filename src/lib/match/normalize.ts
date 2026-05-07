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

/**
 * Lightweight cleanup for an NZBN-bound search query. Preserves case,
 * `&`, hyphens, parentheses — those may all be load-bearing for NZBN's
 * substring index. Only normalises curly quotes and collapses
 * whitespace. Compare to `normalize` (aggressive, used for scoring).
 */
export function normalizeForSearch(name: string): string {
  if (!name) return "";
  return name.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

/**
 * Generate up to ~5 NZBN-compatible search query variants from a raw
 * customer-supplied name. The dispatch sends the first variant always,
 * then fans out to the rest only when the first yields zero or low-
 * confidence candidates.
 *
 * Variants cover:
 *   - junk-words/numbers stripped       ("Carters Christchurch office")
 *   - `&` ↔ `and` swap                  ("Cotter & Stevens")
 *   - parens removed                    ("NPE-Tech (2021)")
 *   - hyphens collapsed                 ("NPE-Tech")
 *   - trailing year dropped             ("Indigo Skies 2022")
 *
 * Returned in priority order (most likely to hit first), deduped, and
 * filtered to length ≥ 2 (NZBN's minimum).
 */
export function generateSearchVariants(rawName: string): string[] {
  if (!rawName) return [];
  const base = normalizeForSearch(rawName);
  if (!base || base.length < 2) return [];

  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (v: string) => {
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length >= 2 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      ordered.push(t);
    }
  };

  // Variant 1 — junk words and bare numeric/year tokens stripped, but
  // case, `&`, hyphens and parens preserved. This is the most likely
  // single best hit so it goes first.
  const cleaned = base
    .split(" ")
    .filter((t) => {
      if (t.length === 0) return false;
      const lower = t.toLowerCase();
      const stripPunct = lower.replace(/[()]/g, "");
      if (QUERY_JUNK_WORDS.has(stripPunct)) return false;
      // Bare numeric token (with or without parens around it)
      if (/^\(?\d+\)?$/.test(t)) return false;
      return true;
    })
    .join(" ");
  add(cleaned);

  // Variant 2 — original, exactly as typed (modulo whitespace).
  add(base);

  // Variant 3 — `&` → `and`
  if (/&/.test(cleaned || base)) {
    add((cleaned || base).replace(/\s*&\s*/g, " and "));
  }

  // Variant 4 — `and` → `&` (some indexes prefer the symbol form)
  if (/\band\b/i.test(cleaned || base)) {
    add((cleaned || base).replace(/\s+and\s+/gi, " & "));
  }

  // Variant 5 — parens removed (content kept)
  if (/[()]/.test(cleaned || base)) {
    add((cleaned || base).replace(/[()]/g, " "));
  }

  // Variant 6 — hyphens to spaces
  if (/-/.test(cleaned || base)) {
    add((cleaned || base).replace(/-/g, " "));
  }

  // Variant 7 — trailing year dropped (covers "Indigo Skies 2022 Ltd"
  // and "NPE-Tech (2021)" style suffixes that name-search engines often
  // strip silently).
  const noYear = (cleaned || base).replace(/\s*\(?(?:19|20)\d{2}\)?\s*$/i, "").trim();
  if (noYear && noYear !== (cleaned || base)) add(noYear);

  return ordered;
}
