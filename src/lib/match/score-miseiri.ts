// Miseiri Logic scorer — opt-in alternative to the default blend.
//
// Designed around the failure modes the council surfaced:
//   - Boundary-moves (AN ↔ A N): spaceless trigram Dice
//   - Typo'd prefix recovery within a candidate: Jaro-Winkler
//   - Truncation (Acme ⊆ Acme Holdings): asymmetric token containment
//
// Levenshtein is kept at a small weight as a tie-breaker for mid-token
// typos that the trigram signal can underweight on short strings.

import { normalizeForCompare } from "./normalize";
import { levenshteinRatio } from "./similarity";
import { spacelessTrigramDice, jaroWinkler, tokenContainment } from "./similarity-extra";

export interface MiseiriScoreInput {
  query: string;
  candidateName: string;
  candidateTradingNames?: string[];
}

export interface MiseiriScoreBreakdown {
  exact: number;
  trigram: number;
  jaroWinkler: number;
  containment: number;
  levenshtein: number;
  tradingName: number;
  total: number;
}

const W_TRIGRAM = 0.35;
const W_JARO = 0.25;
const W_CONTAINMENT = 0.20;
const W_LEVENSHTEIN = 0.10;
const W_TRADING_NAME = 0.10;
const TOTAL_WEIGHT = W_TRIGRAM + W_JARO + W_CONTAINMENT + W_LEVENSHTEIN + W_TRADING_NAME;

export function scoreMiseiri({
  query,
  candidateName,
  candidateTradingNames = [],
}: MiseiriScoreInput): MiseiriScoreBreakdown {
  const nq = normalizeForCompare(query);
  const nc = normalizeForCompare(candidateName);
  if (nq && nq === nc) {
    return {
      exact: 1,
      trigram: 1,
      jaroWinkler: 1,
      containment: 1,
      levenshtein: 1,
      tradingName: 0,
      total: 1,
    };
  }

  const trigram = spacelessTrigramDice(query, candidateName);
  const jw = jaroWinkler(query, candidateName);
  const containment = tokenContainment(query, candidateName);
  const lev = levenshteinRatio(query, candidateName);

  let tn = 0;
  for (const t of candidateTradingNames) {
    if (!t) continue;
    const ntn = normalizeForCompare(t);
    if (ntn && ntn === nq) {
      tn = 1;
      break;
    }
    const r = levenshteinRatio(query, t);
    if (r > tn) tn = r;
  }

  const weighted =
    trigram * W_TRIGRAM +
    jw * W_JARO +
    containment * W_CONTAINMENT +
    lev * W_LEVENSHTEIN +
    tn * W_TRADING_NAME;

  return {
    exact: 0,
    trigram,
    jaroWinkler: jw,
    containment,
    levenshtein: lev,
    tradingName: tn,
    total: weighted / TOTAL_WEIGHT,
  };
}
