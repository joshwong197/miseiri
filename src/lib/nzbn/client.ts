// Thin client over the NZBN register API. Adds:
//  - typed responses
//  - exponential backoff on 429/5xx
//  - shape normalization (addresses can be flat or { addressList })

import type { NzbnEntity, NzbnSearchResponse, NzbnAddress } from "./types";
import { expandAbbreviations } from "../match/normalize";

const BASE_URL = "https://api.business.govt.nz/gateway/nzbn/v5";

class NzbnApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "NzbnApiError";
  }
}

function getKey(): string {
  const key = process.env.NZBN_API_KEY;
  if (!key) throw new NzbnApiError(500, "NZBN_API_KEY not configured");
  return key;
}

function headers() {
  return {
    Accept: "application/json",
    "Ocp-Apim-Subscription-Key": getKey(),
  };
}

async function fetchWithRetry(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, { headers: headers() });
  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    if (attempt < 3) {
      const delay = 500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, attempt + 1);
    }
  }
  return res;
}

const EMPTY_SEARCH: NzbnSearchResponse = { totalResults: 0, page: 1, pageSize: 0, items: [] };

export async function searchByName(searchTerm: string, pageSize = 10): Promise<NzbnSearchResponse> {
  const url = new URL(`${BASE_URL}/entities`);
  url.searchParams.set("search-term", searchTerm);
  url.searchParams.set("page-size", String(pageSize));
  const res = await fetchWithRetry(url.toString());
  // 400/404 → "we can't search for that" — treat as no results, not an error.
  if (res.status === 400 || res.status === 404) return EMPTY_SEARCH;
  if (!res.ok) throw new NzbnApiError(res.status, `Search failed: ${res.statusText}`);
  return res.json();
}

export async function searchByCompanyNumber(companyNumber: string): Promise<NzbnSearchResponse> {
  const url = new URL(`${BASE_URL}/entities`);
  url.searchParams.set("entity-identifier", companyNumber);
  url.searchParams.set("page-size", "5");
  const res = await fetchWithRetry(url.toString());
  if (res.status === 400 || res.status === 404) return EMPTY_SEARCH;
  if (!res.ok) throw new NzbnApiError(res.status, `Company-number search failed: ${res.statusText}`);
  return res.json();
}

/**
 * Strip common compound-name patterns from a customer's name string so
 * we have a cleaner query for the register. We try the original first
 * and fall back to a simplified query only when the original returns
 * no candidates.
 *
 * Heuristics observed in real ledgers:
 *   "Foo Trading - Head Office Foo Legal Ltd"
 *   "Foo Trading Name Bar Legal Society Ltd"
 *   "NZ One Time Customer"  (junk — strip "NZ One Time" prefix)
 */
export function simplifyName(name: string): string | null {
  let s = name.trim();
  // Take the part after " - " when present, that is usually the legal name.
  if (s.includes(" - ")) {
    const after = s.split(" - ").slice(-1)[0].trim();
    // Strip a leading "Head Office" tag.
    s = after.replace(/^head\s+office\s+/i, "").trim();
  }
  // Drop a leading "NZ One Time" prefix used by many AR systems.
  s = s.replace(/^nz\s+one\s+time\s+/i, "").trim();
  // Drop trailing year (e.g. "Ltd 2022" or "Indigo Skies 2022 Ltd").
  s = s.replace(/\b(19|20)\d{2}\b/g, "").replace(/\s{2,}/g, " ").trim();
  // Expand common abbreviations (COMM → COMMERCIAL etc.) so NZBN's
  // substring search has a chance of returning the right candidate.
  const expanded = expandAbbreviations(s);
  if (expanded && expanded !== s.toLowerCase()) s = expanded;
  if (!s || s.toLowerCase() === name.trim().toLowerCase()) return null;
  // Reject simplifications that collapse to a generic single token —
  // e.g. "NZ One Time Staff" → "Staff" would happily match STAFFY LIMITED
  // because the only token is fully contained. Require at least two
  // meaningful tokens or a long enough string to make scoring honest.
  const tokenCount = s.split(/\s+/).filter(Boolean).length;
  if (tokenCount < 2 && s.length < 10) return null;
  return s;
}

export async function getEntity(nzbn: string): Promise<NzbnEntity> {
  const res = await fetchWithRetry(`${BASE_URL}/entities/${nzbn}`);
  if (!res.ok) throw new NzbnApiError(res.status, `Entity fetch failed: ${res.statusText}`);
  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getRoles(nzbn: string): Promise<any> {
  const res = await fetchWithRetry(`${BASE_URL}/entities/${nzbn}/roles`);
  if (res.status === 404) return { roleTypes: [] };
  if (!res.ok) throw new NzbnApiError(res.status, `Roles fetch failed: ${res.statusText}`);
  return res.json();
}

/** Normalize the address shape duality into a flat array. */
export function normalizeAddresses(entity: NzbnEntity): NzbnAddress[] {
  const raw = entity.addresses;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.addressList ?? [];
}

export function pickAddress(entity: NzbnEntity, type: NzbnAddress["addressType"]): NzbnAddress | null {
  const list = normalizeAddresses(entity);
  return list.find((a) => a.addressType === type) ?? null;
}

export function formatAddress(addr: NzbnAddress | null): string | null {
  if (!addr) return null;
  return [addr.address1, addr.address2, addr.address3, addr.postCode]
    .filter((part) => part && part.trim().length > 0)
    .join(", ");
}

export { NzbnApiError };
