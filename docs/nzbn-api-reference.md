# NZBN API — Reference Notes

The cleanser depends on the New Zealand Business Number register API
operated by MBIE / business.govt.nz. This file collects what we know
about the API contract — quirks, gotchas, fields that aren't well
documented — so the code can stay tight and bug fixes don't lose their
context.

Official documentation: https://api.business.govt.nz/api-details#api=nzbn-v5

---

## Auth

- Header: `Ocp-Apim-Subscription-Key: <key>`
- Header: `Accept: application/json`
- The key is provisioned via the business.govt.nz developer portal
  (free, manual approval, ~1 business day).

---

## Endpoints we use

### `GET /entities` — search

Search the register by free-text term.

```
https://api.business.govt.nz/gateway/nzbn/v5/entities
  ?search-term=ACME%20LIMITED
  &page-size=10
  &entity-status=registered
```

Useful query parameters:

| Param              | Notes |
|--------------------|-------|
| `search-term`      | Free text, matches against legal name and trading names. |
| `entity-identifier`| Filter by Companies Office number when known. Returns at most one match for live companies. |
| `entity-status`    | `registered`, `removed`, etc. Default is all statuses. |
| `entity-type`      | `LTD`, `INC`, etc. |
| `page-size`        | Default 5, max 100 (keep modest — larger pages are noticeably slower). |
| `page`             | 1-indexed. |

Response shape:

```json
{
  "totalResults": 42,
  "page": 1,
  "pageSize": 10,
  "items": [
    {
      "nzbn": "9429000000000",
      "entityName": "ACME LIMITED",
      "entityTypeCode": "LTD",
      "entityTypeDescription": "NZ Limited Company",
      "entityStatusCode": "REGISTERED",
      "entityStatusDescription": "Registered",
      "registrationDate": "2014-01-01T00:00:00Z",
      "tradingNames": [...]
    }
  ]
}
```

### `GET /entities/{nzbn}` — entity detail

Fetch the full record for a known NZBN. This is the main enrichment
call — it returns most fields the cleanser surfaces (legal name,
trading names, addresses, ANZSIC codes, contact info if published).

```
https://api.business.govt.nz/gateway/nzbn/v5/entities/9429000000000
```

The response is a richer version of the search result. Notable fields:

- `entityName` — authoritative legal name.
- `tradingNames[]` — array of `{ name, startDate, endDate? }`.
- `addresses` — sometimes a flat array, sometimes `{ addressList: [...] }`.
  **Always defend against both shapes** (Mihari hit this in 2026-04;
  see commit `525bc85`).
- Address types: `REGISTERED`, `POSTAL`, `SERVICE`. `REGISTERED` is the
  one to surface by default.
- `phoneNumbers[]`, `emailAddresses[]`, `websites[]` — only present if
  the entity has elected to publish contact details.
- `classifications` — ANZSIC codes with descriptions.
- `gst` — registration status and number; **may not be on the entity
  detail response** depending on consent flags. Check before assuming.
- `entityStatusDescription` — human-readable; the canonical state.

### `GET /entities/{nzbn}/roles` — directors and shareholders

Returns the role records (directors, partners, trustees, shareholders).

```
https://api.business.govt.nz/gateway/nzbn/v5/entities/9429000000000/roles
```

Two response shapes have been seen in the wild:

1. Flat array of role objects with `roleType`, `roleStatus`, `rolePerson`.
2. Nested: `{ roleTypes: [{ roleType, roles: [...] }] }`.

Code that consumes this **must normalize both**. See Mihari's
`normalizeUploadRoles` for a working example.

A 404 here means the entity has no roles on file (e.g. sole trader,
overseas company) — return an empty list, not an error.

### `GET /entities/{nzbn}/gst` — GST status

Optional enrichment. Not all entities have GST data exposed; expect
both 200-with-empty-payload and 404 responses. Treat 404 as "not
available" rather than an error.

---

## Pagination

`/entities` returns a `totalResults` count alongside `items`. For the
cleanser we never paginate — we take the top N and apply local
similarity scoring. If a user's entity name is generic enough that the
top 10 don't include it, they almost certainly want a fuzzy review
flow rather than a deeper search.

---

## Rate limits and politeness

The published rate limits are not specified, but observed behaviour:

- Sustained high concurrency triggers 429 responses.
- Single-key throughput appears comfortable up to ~5 requests per second.
- Cold-start latency around 200–500ms; warm requests ~150–250ms.

Cleanser policy:

- 100–150ms client-side delay between rows.
- Concurrency cap of 3–5 in-flight requests.
- Exponential backoff on 429/5xx (wait 500ms × 2^attempt, max 3 retries).

---

## Quirks / gotchas

1. **Address shape duality** — `addresses` is sometimes a flat array,
   sometimes wrapped in `{ addressList }`. Always handle both.
2. **Roles shape duality** — same situation for `/roles`.
3. **`entity-identifier` filter** — works for live companies. For
   removed companies, use the search endpoint and post-filter.
4. **Trading-name match** — search hits trading names too; a result's
   `entityName` may not literally contain the search term. Don't bail
   if it looks "off" — verify against `tradingNames[]`.
5. **Macrons and accented characters** — are preserved in responses;
   ensure UTF-8 throughout the pipeline.
6. **Removed entities** — their record is still queryable but the
   `entityStatusDescription` will reflect the removal. Surface this
   honestly rather than filtering them out — the user's CSV may include
   former customers and they want to know.
7. **NZBN format** — always 13 digits, starts with `94290`. We can
   pre-validate input client-side.

---

## Reference: cleanser vs Mihari

Both projects use the same upstream. Mihari's client lives at
`src/lib/api/nzbn.ts` and is a reasonable starting point — but the
cleanser's client adds:

- Retry / backoff (Mihari relies on the engine's batch retry).
- A typed `Entity` interface (Mihari uses `unknown` and casts).
- Optional GST / roles fetching gated by the user's selected fields.

Where the two diverge in behaviour, the cleanser is the authoritative
one — its tests are tighter and its caller surface is narrower.
