// Shared per-row matching logic. Used by:
//   - /api/match-row (browser bulk uploader)
//   - /api/mcp (MCP server tools)
//
// Pure async function: takes a single row spec, runs the same strategy
// ladder (NZBN → company number → name search), returns the enriched
// row. No HTTP concerns, no logging, no transport details.

import { searchByName, searchByCompanyNumber, getEntity, getRoles, simplifyName, NzbnApiError } from "./nzbn/client";
import { decide, type Candidate } from "./match";
import { buildEnrichedRow, type FieldGroups, type EnrichedRow } from "./enrich";

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

  try {
    // Strategy 1: direct NZBN lookup
    if (inputNzbn) {
      const entity = await getEntity(inputNzbn);
      const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;
      return buildEnrichedRow({
        status: "matched",
        method: "nzbn_lookup",
        confidence: 1.0,
        entity,
        fields,
        rolesData,
      });
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

    if (outcome.status !== "matched") {
      const enriched = buildEnrichedRow({
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
      return enriched;
    }

    const entity = await getEntity(outcome.best!.nzbn);
    const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;
    return buildEnrichedRow({
      status: outcome.status,
      method: outcome.method,
      confidence: outcome.confidence,
      entity,
      fields,
      rolesData,
    });
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
