// Map a resolved NZBN entity into the flat enrichment shape the
// frontend writes into the user's spreadsheet. Pure transform; no I/O.

import type { NzbnEntity } from "./nzbn/types";
import { pickAddress, formatAddress, normalizeAddresses, getRoles } from "./nzbn/client";
import type { MatchMethod, MatchStatus } from "./match";

export interface FieldGroups {
  tradingNames?: boolean;
  addresses?: boolean;
  contact?: boolean;
  industry?: boolean;
  gst?: boolean;
  directors?: boolean;
  shareholders?: boolean;
}

export interface EnrichedRow {
  // always-included
  nzbn_status: MatchStatus;
  nzbn_id: string | null;
  legal_name: string | null;
  entity_type: string | null;
  entity_status: string | null;
  confidence: number;
  match_method: MatchMethod | null;

  // optional groups
  trading_names?: string;
  registered_address?: string | null;
  postal_address?: string | null;
  service_address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  anzsic_codes?: string;
  director_count?: number;
  director_names?: string;
  shareholder_groups?: number;

  // candidates for needs_review
  candidates?: { nzbn: string; entityName: string; score: number }[];
  notes?: string;
}

export function buildEnrichedRow(opts: {
  status: MatchStatus;
  method: MatchMethod | null;
  confidence: number;
  entity: NzbnEntity | null;
  fields: FieldGroups;
  rolesData?: unknown;
}): EnrichedRow {
  const { status, method, confidence, entity, fields, rolesData } = opts;

  const out: EnrichedRow = {
    nzbn_status: status,
    nzbn_id: entity?.nzbn ?? null,
    legal_name: entity?.entityName ?? null,
    entity_type: entity?.entityTypeDescription ?? null,
    entity_status: entity?.entityStatusDescription ?? null,
    confidence,
    match_method: method,
  };

  if (!entity) return out;

  if (fields.tradingNames) {
    out.trading_names = (entity.tradingNames ?? [])
      .filter((t) => !t.endDate)
      .map((t) => t.name)
      .join(" | ");
  }

  if (fields.addresses) {
    out.registered_address = formatAddress(pickAddress(entity, "REGISTERED")) ?? formatAddress(normalizeAddresses(entity)[0] ?? null);
    out.postal_address = formatAddress(pickAddress(entity, "POSTAL"));
    out.service_address = formatAddress(pickAddress(entity, "SERVICE"));
  }

  if (fields.contact) {
    out.phone = entity.phoneNumbers?.[0]?.phoneNumber ?? null;
    out.email = entity.emailAddresses?.[0]?.emailAddress ?? null;
    out.website = entity.websites?.[0]?.url ?? null;
  }

  if (fields.industry) {
    out.anzsic_codes = (entity.classifications ?? [])
      .map((c) => `${c.classificationCode ?? ""} ${c.classificationDescription ?? ""}`.trim())
      .filter(Boolean)
      .join(" | ");
  }

  if (fields.directors && rolesData) {
    const directors = extractDirectorNames(rolesData);
    out.director_count = directors.length;
    out.director_names = directors.join(" | ");
  }

  return out;
}

// Optional: GST is a separate fetch — hook in later when the endpoint
// is wired up. For now leave gst fields off until we confirm contract.

function extractDirectorNames(rolesData: unknown): string[] {
  const names: string[] = [];
  const isCurrent = (status: unknown, endDate: unknown) => {
    const s = String(status ?? "").toUpperCase();
    if (s && s !== "ACTIVE") return false;
    if (endDate) return false;
    return true;
  };
  const pushFromRole = (role: Record<string, unknown>, typeName: string) => {
    if (!typeName.toLowerCase().includes("director")) return;
    if (!isCurrent(role.roleStatus, role.endDate)) return;
    const person = (role.rolePerson ?? {}) as Record<string, unknown>;
    const fn = String(person.firstName ?? "").trim();
    const ln = String(person.lastName ?? "").trim();
    const name = `${fn} ${ln}`.trim();
    if (name) names.push(name);
  };

  if (Array.isArray(rolesData)) {
    for (const r of rolesData as Record<string, unknown>[]) {
      const tn = String(r.roleType ?? r.roleTypeDescription ?? r.roleName ?? "");
      pushFromRole(r, tn);
    }
    return names;
  }
  const r = rolesData as Record<string, unknown>;
  if (r?.roleTypes && Array.isArray(r.roleTypes)) {
    for (const rt of r.roleTypes as Record<string, unknown>[]) {
      const tn = String(rt.roleType ?? rt.roleTypeDescription ?? "");
      const roles = (rt.roles ?? []) as Record<string, unknown>[];
      for (const role of roles) pushFromRole(role, tn);
    }
  }
  return names;
}
