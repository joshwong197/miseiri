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

## MCP server

The same matching engine is exposed as a public MCP server at
`https://miseiri.app/api/mcp` (replace with your deployment domain).
Any MCP client — Claude Desktop, Cursor, Claude Code — can call:

- **`lookup_nzbn`** — direct entity lookup by 13-digit NZBN
- **`match_name`** — fuzzy-match a free-text name; returns confidence + candidates when ambiguous
- **`match_batch`** — resolve up to 100 rows in one call

### Claude Desktop install

Add this to your Claude Desktop config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "miseiri": {
      "url": "https://miseiri.app/api/mcp"
    }
  }
}
```

Restart Claude Desktop. Once connected, you can ask things like
*"Look up NZBN 9429000017004"* or *"Match these 20 names against the
NZBN register"* and Claude will call the tools directly.

No auth, no API key. Same privacy posture as the website: only the
name / NZBN / company number you ask about leaves the client. The
server forwards to business.govt.nz and returns the result. Nothing
is logged or stored.

## Deployment

Deploy to Vercel. Set `NZBN_API_KEY` as a project environment variable.
No other infrastructure required.
