# Miseiri 見整理

*see · tidy*

A free, browser-first tool that takes a spreadsheet of customer/supplier
names and returns the same spreadsheet enriched with authoritative NZBN
register data: legal name, trading names, NZBN, status, address, and
optional industry/contact/GST/role fields.

The user's file never leaves their browser. The app proxies single-row
NZBN lookups through a stateless Vercel function (which holds the API
key) and writes results into the spreadsheet client-side. No database,
no persistence, no LLM, no analytics on row content.

See [PRD.md](./PRD.md) for the full product spec and [docs/nzbn-api-reference.md](./docs/nzbn-api-reference.md)
for the upstream API contract notes.

## Local development

```bash
cp .env.example .env.local
# fill in NZBN_API_KEY

npm install
npm run dev
```

## Tests

```bash
npm test
```

## Deployment

Deploy to Vercel. Set `NZBN_API_KEY` as a project environment variable.
No other infrastructure required.
