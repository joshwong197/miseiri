// Shared per-row matching logic. Used by:
//   - /api/match-row (browser bulk uploader)
//   - /api/mcp (MCP server tools)
//
// Pure async function: takes a single row spec, runs the same strategy
// ladder (NZBN → company number → name search), returns the enriched
// row. No HTTP concerns, no logging, no transport details.

import { searchByName, searchByCompanyNumber, getEntity, getRoles, simplifyName, NzbnApiError } from "./nzbn/client";
import { decide, decideMiseiri, type Candidate, stripQueryJunk, generateSearchVariants } from "./match";
import { score } from "./match/score";
import { buildEnrichedRow, type FieldGroups, type EnrichedRow } from "./enrich";

const NZBN_NAME_MISMATCH_THRESHOLD = 0.4;

export type ScoringStrategy = "default" | "miseiri";

export interface MatchOneInput {
  name?: string;
  nzbn?: string;
  companyNumber?: string;
  fields?: FieldGroups;
  matchThreshold?: number;
  /**
   * Which scoring/decision logic to run during the name-search path.
   * "default" — current production blend.
   * "miseiri" — opt-in alternative (trigram + JW + containment + dynamic
   *  gap + sibling trap + reviewReason). For A/B comparison.
   */
  scoringStrategy?: ScoringStrategy;
}

export async function matchOne(input: MatchOneInput): Promise<EnrichedRow> {
  const fields: FieldGroups = input.fields ?? {};
  const inputName = clean(input.name);
  const inputNzbn = clean(input.nzbn);
  const inputCompanyNumber = clean(input.companyNumber);

  let nzbnFallbackNote: string | null = null;

  try {
    // Strategy 1: direct NZBN lookup. On 4xx (bad/unknown NZBN), fall
    // through to name search if a name is supplied — wrong NZBNs in
    // customer ledgers are common and the row's name is often correct.
    if (inputNzbn) {
      try {
        const entity = await getEntity(inputNzbn);

        // NZBN resolved. If the row also supplied a name, sanity-check
        // that the resolved entity matches it. A wrong NZBN that happens
        // to hit a real (but unrelated) company is the worst silent
        // failure — flag it for review instead of trusting blindly.
        if (inputName) {
          const sim = score({ query: inputName, candidateName: entity.entityName }).total;
          if (sim < NZBN_NAME_MISMATCH_THRESHOLD) {
            const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;
            const enriched = buildEnrichedRow({
              status: "needs_review",
              method: "nzbn_lookup",
              confidence: sim,
              entity,
              fields,
              rolesData,
            });
            enriched.candidates = [{
              nzbn: entity.nzbn,
              entityName: entity.entityName,
              score: Number(sim.toFixed(3)),
            }];
            enriched.notes = `Supplied NZBN resolved to "${entity.entityName}", which does not match the row name "${inputName}". Verify before using.`;
            return enriched;
          }
        }

        const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;
        return buildEnrichedRow({
          status: "matched",
          method: "nzbn_lookup",
          confidence: 1.0,
          entity,
          fields,
          rolesData,
        });
      } catch (err) {
        const isLookupMiss = err instanceof NzbnApiError && (err.status === 400 || err.status === 404);
        // No name to fall back to → propagate so the outer catch reports it.
        if (!isLookupMiss || !inputName) throw err;
        nzbnFallbackNote = `Supplied NZBN ${inputNzbn} not found (NZBN ${err.status}); matched by name instead.`;
        // fall through to name strategy below
      }
    }

    // Strategy 2: company number lookup
    if (inputCompanyNumber) {
      const found = await searchByCompanyNumber(inputCompanyNumber);
      const items = found.items ?? [];
      if (items.length === 1) {
        const entity = await getEntity(items[0].nzbn);
        const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;
        return buildEnrichedRow({
          status: "matched",
          method: "company_number_lookup",
          confidence: 1.0,
          entity,
          fields,
          rolesData,
        });
      }
      // Multiple or zero — fall through to name search if name provided.
    }

    // Strategy 3: name-based fuzzy match
    if (!inputName) {
      return buildEnrichedRow({
        status: "error",
        method: null,
        confidence: 0,
        entity: null,
        fields,
      });
    }

    // Scoring uses the aggressively-cleaned form (lowercased, & → and,
    // suffixes stripped) so different surface forms compare equal. The
    // search call is decoupled — see the variant fan-out below — because
    // NZBN's substring index treats `&`, hyphens and parens literally.
    const scoringQuery = stripQueryJunk(inputName) || inputName;

    // Generate up to ~5 search variants from the raw input. We always
    // try the first; if it returns 0 candidates or the top candidate
    // scores below FANOUT_THRESHOLD, we fan out to the rest in parallel
    // and merge by NZBN. Keeps the common case at 1 API call and the
    // hard case at 4–5.
    type SearchItem = NonNullable<Awaited<ReturnType<typeof searchByName>>["items"]>[number];
    const variants = generateSearchVariants(inputName);
    const FANOUT_THRESHOLD = 0.5;
    const merged = new Map<string, SearchItem>();
    let items: SearchItem[] = [];

    if (variants.length > 0) {
      const firstResult = await searchByName(variants[0], 10);
      for (const it of firstResult.items ?? []) merged.set(it.nzbn, it);

      const topScore = merged.size > 0
        ? Math.max(
          ...Array.from(merged.values()).map(
            (it) => score({ query: scoringQuery, candidateName: it.entityName }).total,
          ),
        )
        : 0;

      if (variants.length > 1 && (merged.size === 0 || topScore < FANOUT_THRESHOLD)) {
        const more = await Promise.all(
          variants.slice(1).map((v) =>
            searchByName(v, 10).catch(() => ({ items: [] as SearchItem[] })),
          ),
        );
        for (const r of more) {
          for (const it of r.items ?? []) {
            if (!merged.has(it.nzbn)) merged.set(it.nzbn, it);
          }
        }
      }

      items = Array.from(merged.values());
    }

    // Last-resort: simplifyName fallback when the variant fan-out still
    // turned up nothing. Uses the aggressively-cleaned form so generic
    // single-token simplifications don't auto-match unrelated entities.
    if (items.length === 0) {
      const simpler = simplifyName(scoringQuery);
      if (simpler) {
        const search = await searchByName(simpler, 10);
        items = search.items ?? [];
      }
    }

    const candidates: Candidate[] = items.map((it) => ({
      nzbn: it.nzbn,
      entityName: it.entityName,
      tradingNames: it.tradingNames?.map((t) => t.name),
      entityType: it.entityTypeDescription,
      entityStatus: it.entityStatusDescription,
    }));

    const threshold = typeof input.matchThreshold === "number"
      && input.matchThreshold >= 0.5
      && input.matchThreshold <= 1
      ? input.matchThreshold
      : undefined;
    const useMiseiri = input.scoringStrategy === "miseiri";
    const outcome = useMiseiri
      ? decideMiseiri({ query: scoringQuery, candidates, highConfidenceThreshold: threshold })
      : decide({ query: scoringQuery, candidates, highConfidenceThreshold: threshold });

    let enriched: EnrichedRow;
    if (outcome.status !== "matched") {
      enriched = buildEnrichedRow({
        status: outcome.status,
        method: outcome.method,
        confidence: outcome.confidence,
        entity: null,
        fields,
      });
      enriched.candidates = outcome.candidates.map((c) => ({
        nzbn: c.nzbn,
        entityName: c.entityName,
        score: Number(c.score.toFixed(3)),
      }));
    } else {
      const entity = await getEntity(outcome.best!.nzbn);
      const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;
      enriched = buildEnrichedRow({
        status: outcome.status,
        method: outcome.method,
        confidence: outcome.confidence,
        entity,
        fields,
        rolesData,
      });
    }

    enriched.scoring_strategy = useMiseiri ? "miseiri" : "default";
    const reviewReason = (outcome as { reviewReason?: string }).reviewReason;
    if (reviewReason) enriched.review_reason = reviewReason;

    if (nzbnFallbackNote) {
      enriched.notes = enriched.notes
        ? `${nzbnFallbackNote} ${enriched.notes}`
        : nzbnFallbackNote;
    }
    return enriched;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const upstreamStatus = err instanceof NzbnApiError ? err.status : null;
    const enriched = buildEnrichedRow({
      status: "error",
      method: null,
      confidence: 0,
      entity: null,
      fields,
    });
    enriched.error_message = upstreamStatus ? `NZBN ${upstreamStatus}: ${message}` : message;
    return enriched;
  }
}

function clean(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = typeof v === "string" ? v : String(v);
  const t = s.trim();
  return t.length === 0 ? undefined : t;
}
