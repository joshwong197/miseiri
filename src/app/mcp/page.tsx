import { InfoPage, Section, P, H3, Pre } from "@/components/info-page";

export const metadata = { title: "Miseiri MCP" };

export default function MCPPage() {
  return (
    <InfoPage
      num="三"
      jp="接"
      eyebrow="MCP server"
      title={<>Miseiri inside <em style={{ color: "var(--ai)" }}>Claude</em>.</>}
      intro={
        <>
          The matching engine is also exposed as a Model Context Protocol server, so any
          MCP client — Claude Desktop, Claude.ai connectors, Cursor, Claude Code — can
          look up NZBN entities directly in chat. Public, no auth, no API key.
        </>
      }
    >
      <Section num="一" jp="具" title="The three tools">
        <H3>lookup_nzbn</H3>
        <P>
          Direct entity lookup by 13-digit NZBN. Returns the canonical legal name, status,
          type, addresses, trading names, and other registered details.
        </P>
        <H3>match_name</H3>
        <P>
          Fuzzy-match a free-text business name. Handles typos, missing suffixes, and
          trading-name matches. Returns a status (matched / needs_review / not_found),
          confidence score, and up to 5 alternative candidates when ambiguous.
        </P>
        <H3>match_batch</H3>
        <P>
          Resolve up to 100 rows in a single call. Same matching ladder as match_name, runs
          sequentially server-side to stay polite to the upstream NZBN API.
        </P>
      </Section>

      <Section num="二" jp="設" title="Install in Claude Desktop">
        <P>
          Open your Claude Desktop config file:
        </P>
        <P>
          <strong>macOS</strong>: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code><br />
          <strong>Windows</strong>: <code>%APPDATA%\Claude\claude_desktop_config.json</code>
        </P>
        <P>Add this entry (merge with any existing <code>mcpServers</code> block):</P>
        <Pre>{`{
  "mcpServers": {
    "miseiri": {
      "url": "https://miseiri.vercel.app/api/mcp/mcp"
    }
  }
}`}</Pre>
        <P>
          Quit Claude Desktop completely (system tray → Quit) and reopen. The Miseiri tools
          appear in the MCP indicator next to the message bar.
        </P>
      </Section>

      <Section num="三" jp="繋" title="Install in Claude.ai">
        <P>
          Settings → Connectors → Add custom connector. Use:
        </P>
        <Pre>{`Name:  Miseiri
URL:   https://miseiri.vercel.app/api/mcp/mcp
Auth:  None`}</Pre>
        <P>
          Custom connectors require a Pro / Team / Enterprise plan. Toggle Miseiri on and
          start a new chat — the tools are available immediately.
        </P>
      </Section>

      <Section num="四" jp="例" title="Example prompts">
        <H3>Quick verification</H3>
        <P>
          <em>&ldquo;Use Miseiri to look up NZBN 9429036748471.&rdquo;</em>{" "}
          → Claude calls <code>lookup_nzbn</code> and returns the Fonterra record.
        </P>
        <H3>Single-name resolution</H3>
        <P>
          <em>&ldquo;Is &lsquo;Fontera Cooperative&rsquo; the same as Fonterra?&rdquo;</em>{" "}
          → Claude calls <code>match_name</code>, sees a typo, and surfaces the corrected
          legal name with a confidence score.
        </P>
        <H3>Batch cleanse from chat</H3>
        <P>
          <em>&ldquo;Match these 30 customer names against the NZBN register and give me a
          CSV.&rdquo;</em>{" "}
          → Claude calls <code>match_batch</code>, formats the result as CSV inline, and
          offers it for download.
        </P>
      </Section>

      <Section num="五" jp="安" title="Privacy posture">
        <P>
          Same as the website. Each tool call sends only the name, NZBN, or company number
          you asked about. The server forwards to business.govt.nz, returns the result, and
          forgets. No row content is logged or stored.
        </P>
        <P>
          The server is hosted on Vercel and shares the same Vercel function pool as the
          website. The NZBN API key lives in a server environment variable; you never see
          it.
        </P>
      </Section>
    </InfoPage>
  );
}
