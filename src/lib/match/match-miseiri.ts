// Miseiri Logic decision layer. Same contract as decide(), but with:
//   - dynamic gap requirement (high scores need less margin than borderline)
//   - sibling-cluster trap (very-close near-ties → review, not auto-pick)
//   - structured reviewReason for needs_review outcomes

import { normalizeForCompare } from "./normalize";
import { scoreMiseiri } from "./score-miseiri";
import type { Candidate, MatchOutcome, ScoredCandidate } from "./match";

export type MiseiriReviewReason =
  | "DUPLICATE_ENTITIES"
  | "PARTIAL_MATCH"
  | "TRADING_NAME_MATCH"
  | "LOW_CONFIDENCE";

export interface MiseiriMatchOutcome extends MatchOutcome {
  reviewReason?: MiseiriReviewReason;
}

const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.85;
const MIN_GAP = 0.02;
const GAP_SLOPE = 0.4; // required_gap = max(MIN_GAP, (1 - top) * GAP_SLOPE)
const SIBLING_TOP_THRESHOLD = 0.95;
const SIBLING_GAP_THRESHOLD = 0.05;

export function decideMiseiri({
  query,
  candidates,
  highConfidenceThreshold = DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
}: {
  query: string;
  candidates: Candidate[];
  highConfidenceThreshold?: number;
}): MiseiriMatchOutcome {
  if (!query || candidates.length === 0) {
    return { status: "not_found", method: null, confidence: 0, best: null, candidates: [] };
  }

  const nq = normalizeForCompare(query);

  const scored: ScoredCandidate[] = candidates
    .map((c) => ({
      ...c,
      score: scoreMiseiri({
        query,
        candidateName: c.entityName,
        candidateTradingNames: c.tradingNames,
      }).total,
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  const exactMatches = scored.filter((c) => normalizeForCompare(c.entityName) === nq);
  if (exactMatches.length > 1) {
    // Sibling-cluster: multiple register entries share the exact same
    // legal name (e.g. several "Smith Family Trust" registrations at
    // different addresses). Auto-picking one would be a coin flip — and
    // in a credit-management context, the wrong coin flip could attach
    // a security interest to the wrong entity.
    return {
      status: "needs_review",
      method: null,
      confidence: 0.95,
      best: exactMatches[0],
      candidates: scored.slice(0, 5),
      reviewReason: "DUPLICATE_ENTITIES",
    };
  }
  if (exactMatches.length === 1) {
    return {
      status: "matched",
      method: "exact_name",
      confidence: 0.95,
      best: exactMatches[0],
      candidates: scored,
    };
  }

  const tradingExact = scored.find((c) =>
    (c.tradingNames ?? []).some((t) => normalizeForCompare(t) === nq),
  );
  if (tradingExact) {
    return {
      status: "matched",
      method: "trading_name",
      confidence: 0.9,
      best: tradingExact,
      candidates: scored,
      reviewReason: undefined,
    };
  }

  const top = best.score;
  const gap = second ? top - second.score : 1;

  // Sibling-cluster trap. When the top score is very high but the gap
  // to the runner-up is tiny, we're almost certainly looking at near-
  // identical entities (e.g. several "Smith Family Trust" registrations
  // at different addresses). Auto-picking here is the worst kind of
  // false positive in a credit-management context — flag for review.
  if (top >= SIBLING_TOP_THRESHOLD && gap < SIBLING_GAP_THRESHOLD) {
    return {
      status: "needs_review",
      method: null,
      confidence: top,
      best,
      candidates: scored.slice(0, 5),
      reviewReason: "DUPLICATE_ENTITIES",
    };
  }

  // Dynamic gap. High top scores need less margin to runner-up; low top
  // scores need more, since the absolute confidence is already shaky.
  const requiredGap = Math.max(MIN_GAP, (1 - top) * GAP_SLOPE);
  if (top >= highConfidenceThreshold && (!second || gap >= requiredGap)) {
    return {
      status: "matched",
      method: "fuzzy",
      confidence: top,
      best,
      candidates: scored,
    };
  }

  if (scored.length > 0) {
    const reason: MiseiriReviewReason =
      top >= highConfidenceThreshold ? "DUPLICATE_ENTITIES" : top >= 0.5 ? "PARTIAL_MATCH" : "LOW_CONFIDENCE";
    return {
      status: "needs_review",
      method: null,
      confidence: top,
      best,
      candidates: scored.slice(0, 5),
      reviewReason: reason,
    };
  }

  return { status: "not_found", method: null, confidence: 0, best: null, candidates: [] };
}
