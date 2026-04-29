// Thin client over the NZBN register API. Adds:
//  - typed responses
//  - exponential backoff on 429/5xx
//  - shape normalization (addresses can be flat or { addressList })

import type { NzbnEntity, NzbnSearchResponse, NzbnAddress } from "./types";

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

export async function searchByName(searchTerm: string, pageSize = 10): Promise<NzbnSearchResponse> {
  const url = new URL(`${BASE_URL}/entities`);
  url.searchParams.set("search-term", searchTerm);
  url.searchParams.set("page-size", String(pageSize));
  const res = await fetchWithRetry(url.toString());
  if (!res.ok) throw new NzbnApiError(res.status, `Search failed: ${res.statusText}`);
  return res.json();
}

export async function searchByCompanyNumber(companyNumber: string): Promise<NzbnSearchResponse> {
  const url = new URL(`${BASE_URL}/entities`);
  url.searchParams.set("entity-identifier", companyNumber);
  url.searchParams.set("page-size", "5");
  const res = await fetchWithRetry(url.toString());
  if (!res.ok) throw new NzbnApiError(res.status, `Company-number search failed: ${res.statusText}`);
  return res.json();
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
