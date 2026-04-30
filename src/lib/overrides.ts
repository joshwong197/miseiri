// Per-session override dictionary: input name → forced NZBN.
//
// Lets users codify "we always call them ABC but they're really NZBN
// 9429000123456" so future runs match without manual review. Lives in
// sessionStorage so it survives accidental tab refresh but is gone when
// the user closes the tab — matches the privacy promise.

import { normalizeForCompare } from "./match/normalize";

const STORAGE_KEY = "miseiri.overrides.v1";

export interface OverrideEntry {
  nzbn: string;
  note?: string;
}

export type OverrideMap = Record<string, OverrideEntry>;

export function loadOverrides(): OverrideMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return sanitize(parsed);
  } catch {
    return {};
  }
}

export function saveOverrides(map: OverrideMap): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // sessionStorage full / disabled — non-fatal.
  }
}

export function lookupOverride(map: OverrideMap, inputName: string): OverrideEntry | null {
  const key = normalizeForCompare(inputName);
  if (!key) return null;
  return map[key] ?? null;
}

export function addOverride(
  map: OverrideMap,
  inputName: string,
  nzbn: string,
  note?: string,
): OverrideMap {
  const key = normalizeForCompare(inputName);
  const cleanNzbn = nzbn.replace(/\s+/g, "");
  if (!key || !/^\d{13}$/.test(cleanNzbn)) return map;
  return { ...map, [key]: { nzbn: cleanNzbn, note: note?.trim() || undefined } };
}

export function removeOverride(map: OverrideMap, key: string): OverrideMap {
  const next = { ...map };
  delete next[key];
  return next;
}

// Accept both the canonical `{ key: { nzbn, note } }` shape and a flat
// `{ inputName: "nzbn" }` shape that's friendlier to hand-write.
function sanitize(raw: unknown): OverrideMap {
  if (!raw || typeof raw !== "object") return {};
  const out: OverrideMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeForCompare(k);
    if (!key) continue;
    if (typeof v === "string") {
      const nzbn = v.replace(/\s+/g, "");
      if (/^\d{13}$/.test(nzbn)) out[key] = { nzbn };
    } else if (v && typeof v === "object" && "nzbn" in v) {
      const nzbn = String((v as { nzbn: unknown }).nzbn).replace(/\s+/g, "");
      const note = (v as { note?: unknown }).note;
      if (/^\d{13}$/.test(nzbn)) {
        out[key] = { nzbn, note: typeof note === "string" ? note : undefined };
      }
    }
  }
  return out;
}

export function exportJson(map: OverrideMap): string {
  return JSON.stringify(map, null, 2);
}
