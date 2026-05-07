export { normalize, normalizeForCompare, tokens, stripQueryJunk, expandAbbreviations } from "./normalize";
export { jaccard, levenshtein, levenshteinRatio, tokenPrefixMatch } from "./similarity";
export { spacelessTrigramDice, jaroWinkler, tokenContainment } from "./similarity-extra";
export { score } from "./score";
export type { ScoreBreakdown, ScoreInput } from "./score";
export { scoreMiseiri } from "./score-miseiri";
export type { MiseiriScoreBreakdown, MiseiriScoreInput } from "./score-miseiri";
export { decide } from "./match";
export type {
  Candidate,
  ScoredCandidate,
  MatchInput,
  MatchOutcome,
  MatchStatus,
  MatchMethod,
} from "./match";
export { decideMiseiri } from "./match-miseiri";
export type { MiseiriMatchOutcome, MiseiriReviewReason } from "./match-miseiri";
