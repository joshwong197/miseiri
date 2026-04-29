// Stateless per-row matching endpoint. The browser sends one row at a
// time, gets back the enriched result. No DB, no auth, no logging of
// the input beyond the upstream NZBN call.

import { NextRequest, NextResponse } from "next/server";
import { searchByName, searchByCompanyNumber, getEntity, getRoles, NzbnApiError } from "@/lib/nzbn/client";
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

    const search = await searchByName(body.name.trim(), 10);
    const candidates: Candidate[] = (search.items ?? []).map((it) => ({
      nzbn: it.nzbn,
      entityName: it.entityName,
      tradingNames: it.tradingNames?.map((t) => t.name),
      entityType: it.entityTypeDescription,
      entityStatus: it.entityStatusDescription,
    }));

    const outcome = decide({ query: body.name.trim(), candidates });

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
    const status = err instanceof NzbnApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      buildEnrichedRow({
        status: "error",
        method: null,
        confidence: 0,
        entity: null,
        fields,
      }),
      { status: status === 500 ? 200 : status, headers: { "x-error-message": message } },
    );
  }
}
