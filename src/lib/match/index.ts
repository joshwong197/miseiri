export { normalize, normalizeForCompare, tokens } from "./normalize";
export { jaccard, levenshtein, levenshteinRatio, tokenPrefixMatch } from "./similarity";
export { score } from "./score";
export type { ScoreBreakdown, ScoreInput } from "./score";
export { decide } from "./match";
export type {
  Candidate,
  ScoredCandidate,
  MatchInput,
  MatchOutcome,
  MatchStatus,
  MatchMethod,
} from "./match";
