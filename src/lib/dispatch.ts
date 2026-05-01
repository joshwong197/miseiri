// Shared per-row matching logic. Used by:
//   - /api/match-row (browser bulk uploader)
//   - /api/mcp (MCP server tools)
//
// Pure async function: takes a single row spec, runs the same strategy
// ladder (NZBN → company number → name search), returns the enriched
// row. No HTTP concerns, no logging, no transport details.

import { searchByName, searchByCompanyNumber, getEntity, getRoles, simplifyName, NzbnApiError } from "./nzbn/client";
import { decide, type Candidate } from "./match";
import { score } from "./match/score";
import { buildEnrichedRow, type FieldGroups, type EnrichedRow } from "./enrich";

const NZBN_NAME_MISMATCH_THRESHOLD = 0.4;

export interface MatchOneInput {
  name?: string;
  nzbn?: string;
  companyNumber?: string;
  fields?: FieldGroups;
  matchThreshold?: number;
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

    let search = await searchByName(inputName, 10);
    let items = search.items ?? [];

    // Retry with a simplified version when the original yields nothing.
    // We keep the *original* query as the source-of-truth for scoring so
    // a generic simplification ("Staff") doesn't auto-match STAFFY LIMITED.
    if (items.length === 0) {
      const simpler = simplifyName(inputName);
      if (simpler) {
        search = await searchByName(simpler, 10);
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
    const outcome = decide({ query: inputName, candidates, highConfidenceThreshold: threshold });

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
