// High-level matcher. Decides which strategy applies and what the final
// status / confidence is. Pure functions — caller supplies candidates.

import { normalizeForCompare } from "./normalize";
import { score } from "./score";

export type MatchStatus = "matched" | "needs_review" | "not_found" | "error";

export type MatchMethod =
  | "nzbn_lookup"
  | "company_number_lookup"
  | "exact_name"
  | "fuzzy"
  | "trading_name"
  | "user_picked";

export interface Candidate {
  nzbn: string;
  entityName: string;
  tradingNames?: string[];
  entityType?: string;
  entityStatus?: string;
}

export interface ScoredCandidate extends Candidate {
  score: number;
}

export interface MatchInput {
  query: string;
  candidates: Candidate[];
}

export interface MatchOutcome {
  status: MatchStatus;
  method: MatchMethod | null;
  confidence: number;
  best: ScoredCandidate | null;
  candidates: ScoredCandidate[];
}

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const REVIEW_LOWER_BOUND = 0.65;
const TIE_BREAKER_GAP = 0.05;

export function decide({ query, candidates }: MatchInput): MatchOutcome {
  if (!query || candidates.length === 0) {
    return { status: "not_found", method: null, confidence: 0, best: null, candidates: [] };
  }

  const nq = normalizeForCompare(query);

  const scored: ScoredCandidate[] = candidates
    .map((c) => ({
      ...c,
      score: score({
        query,
        candidateName: c.entityName,
        candidateTradingNames: c.tradingNames,
      }).total,
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  // Exact normalized name match — confidence 0.95.
  const exactMatch = scored.find((c) => normalizeForCompare(c.entityName) === nq);
  if (exactMatch) {
    return {
      status: "matched",
      method: "exact_name",
      confidence: 0.95,
      best: exactMatch,
      candidates: scored,
    };
  }

  // Trading-name exact match — surface legal name with method=trading_name.
  const tradingExact = scored.find(
    (c) => (c.tradingNames ?? []).some((t) => normalizeForCompare(t) === nq),
  );
  if (tradingExact) {
    return {
      status: "matched",
      method: "trading_name",
      confidence: 0.9,
      best: tradingExact,
      candidates: scored,
    };
  }

  // High-confidence fuzzy: top score above threshold AND clear gap to runner-up.
  if (best.score >= HIGH_CONFIDENCE_THRESHOLD) {
    const gap = second ? best.score - second.score : 1;
    if (!second || gap >= TIE_BREAKER_GAP) {
      return {
        status: "matched",
        method: "fuzzy",
        confidence: 0.85 + (best.score - HIGH_CONFIDENCE_THRESHOLD) * 0.5,
        best,
        candidates: scored,
      };
    }
  }

  // Ambiguous: in review band, or top two too close.
  if (best.score >= REVIEW_LOWER_BOUND) {
    return {
      status: "needs_review",
      method: null,
      confidence: best.score,
      best,
      candidates: scored.slice(0, 5),
    };
  }

  // No match.
  return {
    status: "not_found",
    method: null,
    confidence: best.score,
    best: null,
    candidates: scored.slice(0, 3),
  };
}
