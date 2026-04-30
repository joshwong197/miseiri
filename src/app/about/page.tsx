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
      <Section num="一" jp="目" title="Who it's for">
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

      <Section num="二" jp="安" title="The privacy posture">
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

      <Section num="三" jp="無" title="What it isn't">
        <P>
          Miseiri does not monitor entities for changes — that&rsquo;s{" "}
          <a href="https://mihari.co.nz">Mihari</a>, our sister product. Miseiri is a
          one-shot cleanse. Run it once a month, before a credit report, after a CRM import.
        </P>
        <P>
          It also does not look up Australian, UK, or US entities. NZ-only by design. The
          algorithm and architecture would translate, but the API integrations and matching
          fixtures would not.
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
