// Composite similarity score for a single (query, candidate) pair.

import { normalizeForCompare } from "./normalize";
import { jaccard, fuzzyJaccard, levenshteinRatio, tokenPrefixMatch } from "./similarity";

export interface ScoreInput {
  query: string;
  candidateName: string;
  candidateTradingNames?: string[];
}

export interface ScoreBreakdown {
  exact: number;
  jaccard: number;
  levenshtein: number;
  tokenPrefix: number;
  tradingName: number;
  total: number;
}

const W_EXACT = 1.0;
const W_JACCARD = 0.35;
const W_LEVENSHTEIN = 0.4;
const W_TOKEN_PREFIX = 0.15;
const W_TRADING_NAME = 0.1;

export function score({ query, candidateName, candidateTradingNames = [] }: ScoreInput): ScoreBreakdown {
  const nq = normalizeForCompare(query);
  const nc = normalizeForCompare(candidateName);
  const exact = nq && nq === nc ? 1 : 0;
  if (exact) {
    return { exact: 1, jaccard: 1, levenshtein: 1, tokenPrefix: 1, tradingName: 0, total: 1 };
  }

  // Take the better of strict and fuzzy Jaccard — fuzzy catches typos
  // like "Fontera" ↔ "Fonterra" where strict Jaccard scores zero.
  const j = Math.max(jaccard(query, candidateName), fuzzyJaccard(query, candidateName));
  const l = levenshteinRatio(query, candidateName);
  const tp = tokenPrefixMatch(query, candidateName);

  let tn = 0;
  for (const tradingName of candidateTradingNames) {
    const ntn = normalizeForCompare(tradingName);
    if (!ntn) continue;
    if (ntn === nq) {
      tn = 1;
      break;
    }
    const tnLeven = levenshteinRatio(query, tradingName);
    if (tnLeven > tn) tn = tnLeven;
  }

  const weighted = (j * W_JACCARD + l * W_LEVENSHTEIN + tp * W_TOKEN_PREFIX + tn * W_TRADING_NAME);
  const maxWeights = W_JACCARD + W_LEVENSHTEIN + W_TOKEN_PREFIX + W_TRADING_NAME;
  const normalized = weighted / maxWeights;

  return {
    exact: exact * W_EXACT,
    jaccard: j,
    levenshtein: l,
    tokenPrefix: tp,
    tradingName: tn,
    total: normalized,
  };
}
