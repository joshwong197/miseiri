---
name: miseiri
description: Use this skill when calling Miseiri MCP tools (lookup_nzbn, match_name, match_batch) to resolve NZ business names against the NZBN register. Provides heuristics for handling not_found and needs_review results — spell-correcting typos before giving up, retrying at a lower threshold, and recognising sibling-cluster / truncation / duplicate-registry patterns that need a clarifying question rather than a silent pick.
---

# Miseiri matching skill

Miseiri's matcher is fast and tolerant of legal-form variation (Ltd↔Limited, &↔AND, Hldgs↔Holdings, NZ↔New Zealand) but its underlying search is substring-based: typos in the input return zero candidates rather than weak ones. That gap is what you, the LLM, are uniquely good at closing. This skill explains how.

## Score bands

When `match_name` returns:

- **status: matched, confidence ≥ 0.85** — trust it. Done.
- **status: matched, confidence 0.65–0.85** — usually fine, but worth showing the user the legal name and confidence so they can spot the rare miss.
- **status: needs_review** — DO NOT silently pick the top candidate. Surface the candidates and ask. See the "ask, don't guess" patterns below.
- **status: not_found** — don't give up yet. Run the recovery moves in order.

## Recovery moves for not_found

Try these in order. Stop as soon as one returns a match.

### 1. Spell-correct the input

This is the single biggest win. Miseiri's matcher can't help if the upstream search returns zero, and the search returns zero whenever any token in the query has a typo. Read the input, fix obvious typos, and call `match_name` again with the corrected spelling.

Common typo patterns to watch for:

- **Dropped vowels**: `Fletchr` → `Fletcher`, `Distribtn` → `Distribution`, `Mngmnt` → `Management`
- **Dropped consonants**: `Flecher` → `Fletcher`, `Bilding` → `Building`
- **Concatenated words**: `Newzealand` → `New Zealand`, `PlaceMakers` → `Place Makers` (or leave concatenated — Miseiri handles both)
- **Wrong vowel**: `Zealnd` → `Zealand`, `Limted` → `Limited`
- **Phonetic substitution**: `Fronterra` → `Fonterra`

Don't guess wildly. If you can't see an obvious correction, move to step 2.

### 2. Retry at threshold 0.5

Call `match_name` again with `threshold: 0.5`. This surfaces weaker candidates that the default threshold rejected. If any come back, treat them as needs_review and follow the "ask, don't guess" patterns.

### 3. Search by a known-good prefix

If only the suffix is garbled, try the unambiguous part of the name. `Fletcher Distribution Limted` → search just `Fletcher Distribution`.

### 4. Concede — and explain

If steps 1–3 fail, report not_found and tell the user *why*: "Couldn't find a match — likely a sole trader (no NZBN), trading under a different legal name, or deregistered." Don't pretend you know which it is.

## Ask, don't guess — patterns for needs_review

When `match_name` returns needs_review with multiple candidates, recognise the pattern before responding.

### Sibling cluster

The top 2–3 candidates share a stem like `EXTREME BOATS HOLDINGS / EXTREME BOATS PROPERTY / EXTREME BOATS INTERNATIONAL`, all scoring ~0.6, and no plain `EXTREME BOATS LIMITED` exists. This is a corporate group — the bare parent doesn't exist as an entity, only subsidiaries do. **Ask the user for an invoice address, contact email, or registration date** to disambiguate. Don't pick the highest-scoring sibling.

### Duplicate registry entries

Two or more candidates have near-identical normalised names but different NZBNs (e.g. `EASTERN INSTITUTE OF TECHNOLOGY` × 4). This is usually one of: statutory body vs company vehicle, successor entity after a merger, or one is struck off and another is live. **Surface all of them with their entity status** (Registered / Removed / Liquidated) and let the user pick. The status field often makes it obvious which one is current.

### Truncated input

The input ends in a preposition or conjunction (`OF`, `AND`, `&`, `FOR`) — almost certainly truncated mid-name. **Don't trust the top candidate.** Either:
- Run `match_name` with `threshold: 0.5` to surface completion candidates, or
- Ask the user for the full name.

### Person-shaped input

The input looks like a personal name (`EDRICH OPPERMAN`, `JANE SMITH`) with no company suffix. Likely a sole trader. Sole traders don't have NZBNs. Tell the user that's probably what's going on rather than reporting a confusing not_found.

## Use both data points when you have them

If a row has both a name and an NZBN:
- Call `match_name` with **both** `name` and `nzbn` parameters, not `lookup_nzbn` alone.
- Miseiri will use the NZBN as primary key and sanity-check the resolved entity against the name. If they agree, you get a clean match. If they disagree (the NZBN was wrong but happened to resolve to a different real company), you get needs_review with both surfaced — Miseiri will not silently trust a wrong NZBN.
- If the NZBN doesn't resolve at all, Miseiri falls through to name search automatically and tags the result with a note explaining the fallback.

Avoid `lookup_nzbn` for this case — it has no name to sanity-check against.

## Threshold modes

The `threshold` parameter on `match_name` and `match_batch`:

- **Strict (0.85+)** — default. Use for clean inputs where you only want confident matches.
- **Default (0.65)** — slightly looser. Useful when the user has confirmed the input is messy and they'd rather see weak candidates than nothing.
- **Exploratory (0.5)** — minimum. Only for the not_found-recovery retry described above. Always treat results from a 0.5 pass as needs_review and ask the user to pick.

## Workflow for batches

1. Call `match_batch` at the default threshold once.
2. For each row that came back `not_found`, run the four-step recovery (spell-correct → 0.5 threshold → known-good prefix → concede).
3. For each row that came back `needs_review`, identify the pattern (sibling / duplicate / truncated / person) and ask the user accordingly. Don't auto-pick.
4. Report the final mapping back to the user with confidences and any notes Miseiri attached (`notes` field on each row).

The single biggest accuracy win you can give the user is step 2's spell-correction. Don't skip it.
