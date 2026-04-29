# Miseiri 見整理 — Product Requirements

*see · tidy*

A standalone, free, browser-first tool that takes a spreadsheet of
customer/supplier names and returns the same spreadsheet enriched with
authoritative NZBN register data: canonical legal name, trading names,
NZBN, status, addresses, optional industry/contact/GST/role fields, and
a confidence score for each match.

The tool is **free for everyone**, **runs in the browser**, and **never
persists user data on a server**. The only outbound traffic is to the
NZBN register itself (via a thin server-side proxy that hides the API
key). No LLM calls, no analytics piggybacking on the data, no database.

This document captures the engineering and product spec. Visual design
is deliberately out of scope — pick a clean default and iterate later.

---

## 1. Why this exists

Most NZ business systems hold customer names as free-text strings entered
by sales reps, accountants or imported from emails. Over time these
diverge from the legal record:

- "ABC Co" vs "ABC Company Limited" vs "ABC Co. Ltd"
- Trading names recorded instead of legal names
- Old names retained after rebrand
- Typos: "Fonterra Co-operative Group", "Fontera Cooperative"

Without a clean NZBN ID, downstream tools (credit watch, AML, AR systems,
analytics) can't match the same entity across data sources. This tool
gives every row a single authoritative identity in one pass.

It also serves as a reusable matching primitive for other internal apps
(e.g. Mihari bulk-upload uses the same logic — match a name to an NZBN).

---

## 2. User flow

1. **Upload** — user drops a CSV / TSV / Excel / JSON file. The file is
   parsed and held in browser memory only.
2. **Map columns** — UI shows the first ~10 rows and asks the user to
   tag columns:
   - **Entity name** *(required)*
   - **NZBN** *(optional)* — 13-digit number for direct lookup
   - **Company registration number** *(optional)* — Companies Office
     number, e.g. `1234567`. Helps disambiguate when the name is fuzzy
     but the company number is on file.
   - Other columns are passed through unchanged.

   Address is *not* offered as a disambiguator — too many companies
   share addresses (registered office at an accountant or law firm),
   so it produces wrong matches.
3. **Choose fields** — user selects which NZBN data they want appended
   to the output. See section 5.
4. **Process** — rows are resolved one at a time against the NZBN API
   via a stateless server proxy. The user sees a live progress bar,
   live counters (matched / needs review / not found / errors) and a
   streaming results table. They can pause, resume, stop or retry
   failed rows.
5. **Review** — for any row with multiple plausible matches or a fuzzy
   match below a confidence threshold, the user sees a side-by-side
   comparison and picks the right one or marks as "no match".
6. **Download** — user exports the enriched file (same format as input,
   plus the selected columns).

No accounts, no sign-up, no usage caps beyond the practical limit
(section 7). Refreshing the page wipes everything — the user is told
this clearly before they start.

---

## 3. Input formats

| Format | Notes |
|--------|-------|
| **CSV** | **Recommended.** UTF-8, LF or CRLF line endings, comma-separated, fields with commas wrapped in double quotes, header row in row 1. |
| TSV    | Treat as CSV with tab delimiter. |
| Excel  | `.xlsx` parsed with SheetJS. First sheet by default; let user pick another sheet. |
| JSON   | Array of objects, or `{ items: [...] }` / `{ entities: [...] }` envelopes. Useful for programmatic users. |

### Recommended format to minimise errors and lag

**CSV with a header row, UTF-8 encoding, no merged cells, no formulas.**
A downloadable template is provided on the upload page:

```csv
entity_name,nzbn,company_number
ABC Limited,,
Fontera Cooperative,,
,9429000000000,
Smith & Jones Ltd,,1234567
```

- CSV avoids the parsing surprises Excel introduces (merged cells,
  formulas, rich-text, multiple sheets, regional date formats).
- UTF-8 prevents mangled macrons / accented characters in Māori names.
- Quoted fields handle commas and ampersands cleanly.

Excel is supported but the upload page nudges users towards CSV with a
small "use CSV for fastest results" hint.

---

## 4. Matching algorithm

Input: `{ name: string, nzbn?: string, companyNumber?: string }`

Output: `{ status, nzbn, legalName, correctedLegalName, ..., confidence, candidates? }`

### 4.1 Match strategy, in order

1. **Direct NZBN lookup** — if input has a 13-digit NZBN, hit
   `GET /entities/{nzbn}` and return. Confidence = 1.0.
2. **Direct company-number lookup** — if input has a company number, the
   NZBN search supports filtering by `entityIdentifier` (the registered
   company number). Use that to fetch the unique entity. Confidence =
   1.0 if exactly one result.
3. **Exact name match** — search NZBN register by name, return a
   candidate that matches case-insensitive normalized equality
   (strip "Limited"/"Ltd"/punctuation/whitespace). Confidence = 0.95.
4. **High-confidence fuzzy match** — top-N results scored with a
   weighted similarity metric (4.2). If the best score is ≥ 0.85 *and*
   significantly above the second-best, accept it. Confidence = 0.85–0.95.
5. **Ambiguous fuzzy match** — top score in 0.65–0.85, or top two scores
   within 0.05 of each other → return up to 5 candidates and flag for
   user review. Status = `needs_review`.
6. **No match** — top score below 0.65 → status = `not_found`. Provide
   the top 3 candidates anyway in case the user wants to manually pick.

### 4.2 Similarity metric

Composite score with weights:

| Component | Weight | Purpose |
|-----------|--------|---------|
| Normalized exact equality | 1.0 if true, 0 otherwise | Catch trivial cases |
| Token-set Jaccard | 0.4 | Order-insensitive: "Smith & Jones Ltd" ↔ "Jones and Smith Ltd" |
| Levenshtein ratio on normalized strings | 0.3 | Typos: "Fontera" ↔ "Fonterra", "ABCe" ↔ "ABCee" |
| Token-prefix match | 0.2 | "ABC" ↔ "ABC Limited" |
| Trading-name match (if NZBN result has trading_names) | 0.1 | Common case in NZ |

Normalize before scoring:
- Lowercase
- Strip "limited", "ltd", "company", "co", "the", "&" / "and"
- Strip punctuation
- Collapse whitespace
- For Levenshtein: also strip common suffixes more aggressively

Tune thresholds against a labelled test set during development (~200
hand-labelled customer rows from real ledgers). **Do not** ship without
this — pick-from-thin-air thresholds will be wrong.

### 4.3 Disambiguation hints

If the input includes a company number, that's a hard match. No fuzzy
disambiguation needed.

Address is **not** used as a disambiguator. Multiple companies often
share the same registered office (accountant, lawyer, virtual-office
provider) and using address would produce confidently-wrong matches.

If the input has a region/city in another column, it could be used as a
soft tie-breaker on otherwise-tied candidates — but this is opt-in via
the column-mapping step, and only nudges, never decides.

---

## 5. Field selection — choose your output

After column mapping and before processing, the user chooses which NZBN
fields to fetch and append. Fewer fields = faster (fewer API calls per
row, smaller payloads).

### Always included (free, single API call)

- `nzbn_status` — `matched` / `needs_review` / `not_found` / `error`
- `nzbn_id` — the 13-digit NZBN
- `legal_name` — exactly as on the register
- **`corrected_legal_name`** — the register's legal name surfaced as a
  separate column so the user can compare against their original input
  and use it as the canonical name (e.g. input "ABCe Limited" →
  corrected "ABCee Limited"). Always populated when a match is found,
  blank otherwise.
- `entity_type` — "NZ Limited Company" etc.
- `entity_status` — "Registered", "In Liquidation" etc.
- `confidence` — 0.0–1.0
- `match_method` — `nzbn_lookup` / `company_number_lookup` /
  `exact_name` / `fuzzy` / `user_picked`

### Optional groups (user ticks what they want)

| Group | Fields appended | API cost |
|-------|-----------------|----------|
| **Trading names** | `trading_names` (pipe-separated) | Free (in entity record) |
| **Addresses** | `registered_address`, `postal_address`, `service_address` | Free (in entity record) |
| **Contact** | `phone`, `email`, `website` (when published) | Free (in entity record) |
| **Industry** | `anzsic_codes` (pipe-separated) | Free (in entity record) |
| **GST** | `gst_registered` (bool), `gst_number` | +1 call per row (separate endpoint) |
| **Directors** | `director_count`, `director_names` (pipe-separated) | +1 call per row |
| **Shareholders** | `shareholder_groups`, `shareholder_summary` | +1 call per row |

The UI shows a live time estimate as the user toggles groups, e.g.
*"~3 minutes to process 200 rows with the selected fields"*.

### Output column ordering

Original input columns first (preserved exactly), then the always-
included NZBN columns, then the selected optional columns in the order
listed above. Easy to delete columns the user changes their mind about.

The user can also choose, before download:
- Append to original (default)
- Replace input name column with `corrected_legal_name`
- Generate a separate "needs review" file alongside the main one

---

## 6. Architecture

### 6.1 Browser-first, no server-side persistence

```
┌──────────────┐    rows    ┌────────────────┐   1 row     ┌────────────┐
│   Browser    │───────────▶│ /api/match-row │────────────▶│  NZBN API  │
│ (file in mem)│◀───────────│   (Vercel)     │◀────────────│            │
└──────────────┘   match    └────────────────┘   entity    └────────────┘
        │
        ▼
   download.csv
```

- The user's file never leaves their browser.
- The Vercel function is a stateless proxy that hides the NZBN API key.
- No database, no Supabase, no Redis, no Railway. The whole app is a
  single Next.js project deployable to Vercel hobby tier.
- Privacy claim is genuine: only the entity name (or NZBN, or company
  number) per row is sent over the wire — and only to the NZBN proxy,
  which immediately forwards it to the official register without
  logging.

### 6.2 Avoid the timeout trap

The Mihari bulk upload hit Vercel's 60-second function timeout when it
tried to process 200 rows in one POST. The fix — used here from day one
— is **per-row processing with a client-side loop**:

- `POST /api/match-row` accepts one row, makes 1–4 NZBN calls based on
  selected field groups, returns the enriched row. Always finishes well
  within timeout.
- The client orchestrates the loop, fires requests sequentially (or
  with a small concurrency window), updates UI per result.
- Pause / resume / stop are trivially implementable.

### 6.3 Live progress UI

Mirror Mihari's upload page:
- **Progress bar** — completed / total, percentage
- **Live count tiles** — matched / needs review / not found / errors
- **Streaming results table** — rows appear in `pending`, flip to
  `processing` (spinner) on request, then to a final state with status
  glyph
- **Pause / Resume / Stop** controls
- **Retry failed** button at the end
- **Estimated time remaining**, recomputed every 10 rows

### 6.4 NZBN API access

Single API key in env on the Vercel function. Be polite:

- 100–150ms inter-row delay client-side
- Concurrency cap of 3–5 in-flight requests
- Exponential backoff on 429/5xx (retry up to 3 times then mark `error`)

No caching layer in v1 — keeps the architecture simple and there's no DB
to cache into. If hot-name patterns emerge, an in-memory LRU on the
serverless function would be a small later addition.

### 6.5 Tech stack

- Next.js 16 (App Router, TypeScript)
- React for UI, Tailwind for styling
- SheetJS for Excel parsing, Papa Parse for CSV
- Deployed to Vercel
- The matching module (`src/lib/match/*`) lives in `src/lib/` with
  **zero framework imports** — just pure TypeScript. Designed to be
  extracted as a standalone npm package once a second consumer
  (Mihari being client #2) wants it.

---

## 7. Practical limits

No accounts, no tiers, but practical caps to protect users from
themselves and the NZBN API from abuse.

| Dimension | Limit | Reason |
|-----------|-------|--------|
| Rows per file | **10,000 hard cap** | Browser memory and user patience. At ~1.5s/row, 10k rows = ~4 hours. Show a strong warning above 2,000 rows and a stronger one above 5,000. |
| File size | **50 MB** | Practical limit for client-side parsing. Most CSVs of 10k rows are well under this. |
| Concurrent in-flight requests | 3–5 | NZBN politeness. |
| Retries per row | 3 with exponential backoff | Recover from transient 5xx. |
| Time per row (selected fields = identity only) | ~0.8–1.5s | Single NZBN call. |
| Time per row (selected fields = everything) | ~3–5s | Three or four sequential NZBN calls. |

Where do these caps come from?

- **10,000 rows**: this is the limit at which the browser becomes
  sluggish on mid-spec hardware (DOM table rendering, JSON-in-memory).
  We could go higher with virtualized table rendering — worth doing in
  v1 actually so the table stays smooth at 10k. Without virtualization,
  closer to 2,000 is the comfort zone.
- **No Vercel timeout to worry about** since each request is a single
  row and finishes fast.
- **No background worker needed** because there's no scheduled job —
  the user is on the page driving the loop. If they close the tab,
  processing stops, which is fine.

For volumes above 10k, the recommendation is to split the file into
chunks and run them sequentially. Could add a "split by 5k" helper in
v2 if it becomes a real friction point.

---

## 8. API surface (for Mihari and other internal apps)

A small REST surface so the cleanser can be used as a backend matching
service from other apps:

- `POST /api/v1/match` — single row in, single match result out
- `POST /api/v1/lookup/{nzbn}` — direct fetch (mirrors NZBN entity API
  but with a stable contract owned by us)

No batch/job API in v1 — the per-row endpoint is the same one the
browser uses, and other apps can do the same loop pattern. If a real
need for server-orchestrated batch emerges, add it then.

No API auth in v1. Same rate-limiting principles apply — IP-based
sliding window if abuse appears.

---

## 9. Out of scope for v1

- ASIC (AU) or other-country registers
- Bank account / GST validation beyond what NZBN exposes
- Reverse lookup (address → entities at that address)
- Real-time monitoring (that's Mihari's job)
- LLM-assisted name interpretation
- Server-side caching layers
- Job persistence / resume across sessions
- Accounts, tiers, billing

---

## 10. Open questions

1. **Match-quality reporting** — should we expose the per-row similarity
   score components in the output? Useful for power users, noise for
   others. Maybe behind a "show details" toggle.
2. **Trading name handling** — when input matches a *trading* name, do
   we accept silently and surface the legal name, or flag as
   `needs_review`? Probably accept with `match_method = "trading_name"`.
3. **Excel parsing edge cases** — multiple sheets, merged cells,
   formulas, rich-text values. Pick a sensible subset; SheetJS handles
   most but not all.
4. **Confidence threshold tuning** — needs the labelled test set
   (4.2). Without it, thresholds are guesses.
5. **Virtualized results table** — implement from v1 to comfortably
   handle 10k rows? Slightly more code, much smoother UX. Probably yes.
6. **Public usage analytics** — no per-user data is collected, but a
   simple counter ("X spreadsheets cleaned, Y entities matched") on
   the marketing page would be nice. Aggregate-only, no row content
   stored.

---

## 11. Suggested build order

1. **Pure matching module + test suite** — no UI, no API. Get the
   algorithm right against a hand-labelled fixture set.
2. **`POST /api/match-row`** — thin wrapper over the matching module +
   NZBN client.
3. **Single-page upload UI** — drag-drop → column mapping → field
   selection → live progress → review ambiguous → download. Lift
   Mihari's progress UI patterns directly.
4. **Virtualized results table** — needed early so the 10k cap works
   smoothly.
5. **Field selection groups** — wire up the optional API calls
   (GST, directors, shareholders) and time estimate.
6. **Excel + JSON inputs** alongside the initial CSV-only support.
7. **Review modal** for ambiguous matches.
8. **Public API (`/api/v1/match`)** for Mihari to consume.
9. **Polish** — UX copy, error messaging, marketing landing page.

Steps 1–4 give a working tool you can use yourself. Everything after is
expansion and productisation.
