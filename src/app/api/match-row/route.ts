// Stateless per-row matching endpoint. The browser sends one row at a
// time, gets back the enriched result. No DB, no auth, no logging of
// the input beyond the upstream NZBN call.

import { NextRequest, NextResponse } from "next/server";
import { searchByName, searchByCompanyNumber, getEntity, getRoles, simplifyName, NzbnApiError } from "@/lib/nzbn/client";
import { decide, type Candidate } from "@/lib/match";
import { buildEnrichedRow, type FieldGroups, type EnrichedRow } from "@/lib/enrich";

interface MatchRowBody {
  name?: string;
  nzbn?: string;
  companyNumber?: string;
  fields?: FieldGroups;
}

export async function POST(req: NextRequest) {
  let body: MatchRowBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fields: FieldGroups = body.fields ?? {};

  try {
    // Strategy 1: direct NZBN lookup
    if (body.nzbn?.trim()) {
      const entity = await getEntity(body.nzbn.trim());
      const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;
      const enriched = buildEnrichedRow({
        status: "matched",
        method: "nzbn_lookup",
        confidence: 1.0,
        entity,
        fields,
        rolesData,
      });
      return NextResponse.json(enriched satisfies EnrichedRow);
    }

    // Strategy 2: company number lookup
    if (body.companyNumber?.trim()) {
      const found = await searchByCompanyNumber(body.companyNumber.trim());
      const items = found.items ?? [];
      if (items.length === 1) {
        const entity = await getEntity(items[0].nzbn);
        const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;
        return NextResponse.json(
          buildEnrichedRow({
            status: "matched",
            method: "company_number_lookup",
            confidence: 1.0,
            entity,
            fields,
            rolesData,
          }),
        );
      }
      // Multiple or zero — fall through to name search if name provided.
    }

    // Strategy 3: name-based fuzzy match
    if (!body.name?.trim()) {
      return NextResponse.json(
        buildEnrichedRow({
          status: "error",
          method: null,
          confidence: 0,
          entity: null,
          fields,
        }),
        { status: 200 },
      );
    }

    const queryName = body.name.trim();
    let search = await searchByName(queryName, 10);
    let items = search.items ?? [];

    // If the original returns nothing, retry once with a simplified
    // version (drop "NZ One Time" prefix, take part after " - ", drop
    // trailing year). Catches compound names like
    // "Ideal Electrical - Head Office Rexel New Zealand".
    let usedQuery = queryName;
    if (items.length === 0) {
      const simpler = simplifyName(queryName);
      if (simpler) {
        usedQuery = simpler;
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

    const outcome = decide({ query: usedQuery, candidates });

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
      return NextResponse.json(enriched);
    }

    // Matched — fetch full detail for the chosen candidate.
    const entity = await getEntity(outcome.best!.nzbn);
    const rolesData = fields.directors ? await getRoles(entity.nzbn) : undefined;

    return NextResponse.json(
      buildEnrichedRow({
        status: outcome.status,
        method: outcome.method,
        confidence: outcome.confidence,
        entity,
        fields,
        rolesData,
      }),
    );
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
    // Always 200 — the UI reads body.nzbn_status, not the HTTP status.
    return NextResponse.json(enriched, { status: 200 });
  }
}
