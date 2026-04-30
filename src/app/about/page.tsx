import { InfoPage, Section, P, H3 } from "@/components/info-page";

export const metadata = { title: "About Miseiri" };

export default function AboutPage() {
  return (
    <InfoPage
      num="一"
      jp="概"
      eyebrow="About"
      title={<>A clean spreadsheet, <em style={{ color: "var(--ai)" }}>one row at a time</em>.</>}
      intro={
        <>
          Miseiri (見整理 — <em>see · tidy</em>) takes your customer or supplier list and
          resolves every entry against the New Zealand Business Number register. You get back
          the same file with the canonical legal name, NZBN, status, and registered details
          appended. Free, browser-first, nothing stored.
        </>
      }
    >
      <Section num="一" jp="謝" title="A nod to NZBN Data Match">
        <P>
          Miseiri exists because the New Zealand Business Number register exists.
          Their{" "}
          <a href="https://www.nzbn.govt.nz/using-the-nzbn/nzbn-services/business-match/">
            NZBN Data Match
          </a>{" "}
          service does the same broad job — upload a list of names, get back register
          identifiers — and it&rsquo;s the reason this kind of cleanse is possible at
          all. Big thank you to the NZBN team for keeping the public API open and the
          register clean.
        </P>
        <P>
          We built Miseiri as a sharper alternative for a few specific reasons:
        </P>
        <P>
          <strong>Faster turnaround.</strong> Miseiri streams results row-by-row in your
          browser; you watch the matches arrive live and can stop, retry, or override at
          any point. No batch wait, no email-when-ready.
        </P>
        <P>
          <strong>Confidence threshold control.</strong> You decide where the auto-match
          line sits. Strict 95% for credit risk, balanced 85% for typical use, permissive
          75% when you plan to eyeball every row. Anything below the line surfaces with
          full candidate context, not a binary yes/no.
        </P>
        <P>
          <strong>MCP availability.</strong> The same engine is reachable as an MCP server,
          so Claude, ChatGPT, Cursor and other AI clients can resolve names directly from
          chat — no spreadsheet round-trip.
        </P>
        <P>
          <strong>Retry, override, candidate review.</strong> Per-row retry, one-click
          rejection of bad matches, and a session-scoped override dictionary for the
          &ldquo;this name always means this NZBN&rdquo; cases that come up in real
          ledgers.
        </P>
        <P>
          <strong>Browser-first and stateless.</strong> Your file never leaves your tab;
          only the per-row name field is sent over the wire, and only to the official
          register.
        </P>
      </Section>

      <Section num="二" jp="目" title="Who it's for">
        <P>
          Credit teams, accountants, AML analysts, and anyone keeping a list of NZ businesses
          who&rsquo;s tired of seeing the same customer recorded as &ldquo;ABC Co&rdquo;,
          &ldquo;ABC Company Limited&rdquo;, and &ldquo;A B C Ltd&rdquo; across three systems.
        </P>
        <P>
          One pass through Miseiri gives every row a single authoritative identity, ready to
          import back into your accounting system, credit watchlist, or analytics pipeline.
        </P>
      </Section>

      <Section num="三" jp="安" title="The privacy posture">
        <P>
          Your file never leaves your browser. Miseiri parses it in memory, sends only the
          name (or NZBN, or company number) for each row to a thin Vercel proxy, and the proxy
          forwards that single field to business.govt.nz — the official NZBN register.
        </P>
        <P>
          The proxy holds the API key so you don&rsquo;t need one. It logs nothing about row
          content. There is no database, no analytics on your data, no LLM in the matching
          path. When you close the tab, it&rsquo;s gone.
        </P>
        <H3>What gets sent</H3>
        <P>
          Per row: the entity name you mapped, plus optional NZBN or Companies Office number.
          Nothing else — not the financial amounts, internal customer codes, addresses, or any
          other column you bring along for the ride.
        </P>
        <H3>What stays put</H3>
        <P>
          Every other column in your spreadsheet. Miseiri reads them once to render the
          preview, then passes them through to the output unchanged.
        </P>
      </Section>

      <Section num="四" jp="無料" title="The pricing">
        <P>
          Free. No accounts, no tiers, no usage caps beyond the practical one-file-at-a-time
          limit (10,000 rows). The only outbound traffic is to the official register itself.
        </P>
      </Section>
    </InfoPage>
  );
}
