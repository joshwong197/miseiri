import { InfoPage, Section, P, H3, Pre } from "@/components/info-page";

export const metadata = { title: "Miseiri MCP" };

export default function MCPPage() {
  return (
    <InfoPage
      num="三"
      jp="接"
      eyebrow="MCP server"
      title={<>Miseiri inside <em style={{ color: "var(--ai)" }}>anywhere</em>.</>}
      intro={
        <>
          The matching engine is also exposed as a Model Context Protocol server, so any
          MCP client — Claude.ai, Claude Desktop, Cursor, ChatGPT, Cline, Continue, Zed —
          can look up NZBN entities directly in chat. Public, no auth, no API key.
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

      <Section num="二" jp="繋" title="Add to your client">
        <P>
          Whichever MCP client you use, the install reduces to pasting one URL. There&rsquo;s
          no API key, no auth, no installer to download.
        </P>
        <Pre>https://miseiri.vercel.app/api/mcp/mcp</Pre>
        <P>
          Find the &ldquo;add MCP server&rdquo; or &ldquo;custom connector&rdquo; setting in
          your client and paste the URL above. Name it whatever you like — &ldquo;Miseiri&rdquo;
          is conventional. Leave authentication as <em>None</em>.
        </P>
        <P>
          On Claude.ai, custom connectors require a Pro / Team / Enterprise plan. Other
          clients (Claude Desktop, Cursor, Cline, ChatGPT, Zed, Continue) accept the URL
          directly.
        </P>
      </Section>

      <Section num="三" jp="例" title="Example prompts">
        <H3>Quick verification</H3>
        <P>
          <em>&ldquo;Use Miseiri to look up NZBN 9429036748471.&rdquo;</em>{" "}
          → calls <code>lookup_nzbn</code> and returns the Fonterra record.
        </P>
        <H3>Single-name resolution</H3>
        <P>
          <em>&ldquo;Is &lsquo;Fontera Cooperative&rsquo; the same as Fonterra?&rdquo;</em>{" "}
          → calls <code>match_name</code>, sees a typo, and surfaces the corrected
          legal name with a confidence score.
        </P>
        <H3>Batch cleanse from chat</H3>
        <P>
          <em>&ldquo;Match these 30 customer names against the NZBN register and give me a
          CSV.&rdquo;</em>{" "}
          → calls <code>match_batch</code>, formats the result as CSV inline, and offers
          it for download.
        </P>
      </Section>

      <Section num="四" jp="技" title="Optional: install the skill">
        <P>
          The MCP tools work with any client out of the box. If you use Claude Code or Claude
          Desktop, you can additionally install the <em>Miseiri skill</em> — a one-file
          instruction set that teaches the model how to recover from typos, low-confidence
          rows, and ambiguous candidates the matcher alone can&rsquo;t handle. Spell-correct
          before giving up, retry at threshold 0.5, ask before picking from a sibling
          cluster, that sort of thing.
        </P>
        <P>
          Download:{" "}
          <a href="/skills/miseiri/SKILL.md" download style={{ color: "var(--ai)", textDecoration: "underline" }}>
            SKILL.md
          </a>
        </P>
        <P>
          Install (Claude Code / Desktop) — drop the file at:
        </P>
        <Pre>~/.claude/skills/miseiri/SKILL.md</Pre>
        <P>
          On Windows that&rsquo;s <code>%USERPROFILE%\.claude\skills\miseiri\SKILL.md</code>.
          Restart your client; the skill auto-loads when you mention Miseiri or call any of
          its tools. The file is plain markdown — read it, edit it, fork it. The biggest
          single accuracy win it adds is spell-correcting messy ledger rows before reporting
          not_found.
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
