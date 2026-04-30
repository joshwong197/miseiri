import { InfoPage, Section, P, H3 } from "@/components/info-page";

export const metadata = { title: "How Miseiri works" };

export default function HowItWorksPage() {
  return (
    <InfoPage
      num="二"
      jp="構"
      eyebrow="How it works"
      title={<>The matcher, <em style={{ color: "var(--ai)" }}>explained</em>.</>}
      intro={
        <>
          Miseiri runs each row through a strategy ladder — direct lookup if you have an
          identifier, fuzzy name match if you don&rsquo;t — and surfaces ambiguity instead of
          guessing. Here&rsquo;s exactly what happens.
        </>
      }
    >
      <Section num="一" jp="順" title="The strategy ladder">
        <P>
          For each row, Miseiri tries strategies in order and stops at the first that
          succeeds.
        </P>
        <H3>1. Direct NZBN lookup</H3>
        <P>
          If your row has a 13-digit NZBN, we fetch the entity record straight from the
          register. Confidence 1.00. <code>match_method = nzbn_lookup</code>.
        </P>
        <H3>2. Companies Office number</H3>
        <P>
          If your row has a company number (e.g. <code>1234567</code>) and no NZBN, we
          search the register by that number. Single hit ⇒ match. Confidence 1.00.
        </P>
        <H3>3. Exact name match</H3>
        <P>
          We search the register for the name and check whether any returned candidate
          matches exactly after normalization (lowercase, strip &ldquo;Limited&rdquo;,
          punctuation, whitespace). Confidence 0.95.
        </P>
        <H3>4. High-confidence fuzzy match</H3>
        <P>
          The top candidate from the register is scored using a composite of token-set
          Jaccard, Levenshtein ratio, and token-prefix match. If the score is above the
          threshold (default 85%) <em>and</em> there&rsquo;s a clear gap to the runner-up,
          we accept it. <code>match_method = fuzzy</code>.
        </P>
        <H3>5. Needs review</H3>
        <P>
          If candidates exist but none clears the bar — score below threshold, or top two
          too close — we return up to 5 candidates and flag the row{" "}
          <strong>needs_review</strong>. You pick the right one in the UI.
        </P>
        <H3>6. Not found</H3>
        <P>
          Only when the register itself returns zero candidates. Often this is a typo too far
          from the registered spelling — Miseiri retries once with a simplified version
          (drops &ldquo;Limited&rdquo; suffixes, takes the part after &ldquo; - &rdquo;,
          drops trailing year) before giving up.
        </P>
      </Section>

      <Section num="二" jp="信" title="The confidence threshold">
        <P>
          The threshold slider on the Choose Fields step controls when Miseiri auto-matches
          versus when it sends you to review. The default 85% catches typos and word-order
          differences while staying conservative on near-misses.
        </P>
        <H3>When to lower it</H3>
        <P>
          Going to 75% catches partial names — &ldquo;Fontera Cooperative&rdquo; matching{" "}
          &ldquo;Fonterra Cooperative Group Limited&rdquo;. Use only when you plan to
          eyeball every match.
        </P>
        <H3>When to raise it</H3>
        <P>
          95%+ accepts only near-identical names. Useful when you&rsquo;re using Miseiri
          as a strict identity validator and want anything ambiguous routed to review.
        </P>
        <P>
          Whatever the threshold, low-confidence candidates always appear in <em>Needs
          review</em> with the full candidate list — you never lose visibility.
        </P>
      </Section>

      <Section num="三" jp="辞" title="The override dictionary">
        <P>
          Sometimes you know a name always means a specific NZBN regardless of what the
          matcher thinks — your books call them &ldquo;ABC Co&rdquo; but they&rsquo;re
          really &ldquo;ABC Holdings (NZ) Limited&rdquo;. Add an entry to the override
          dictionary on the Choose Fields step and every future row with that input name
          resolves directly to the NZBN you specified.
        </P>
        <P>
          Overrides live in your tab&rsquo;s session storage — closing the tab clears
          them. Export to JSON to keep them across sessions. Import to share with
          colleagues. Saving an override from a confirmed match takes one click.
        </P>
      </Section>

      <Section num="四" jp="重" title="Deduplication">
        <P>
          The same customer often appears multiple times in real ledgers (one billed under
          several bill-to entities, branches under a parent). Miseiri normalizes each row&apos;s
          name once at upload and caches results in-session — duplicate names are processed
          once and the result propagates.
        </P>
        <P>
          You see a tag in the result column showing which rows were resolved from the cache
          rather than a fresh API call.
        </P>
      </Section>

      <Section num="五" jp="出" title="The output">
        <P>
          Three formats:
        </P>
        <P>
          <strong>Excel</strong> — when you uploaded an .xlsx, we append the new columns
          to your original workbook, preserving formatting, formulas, and other sheets.
        </P>
        <P>
          <strong>CSV</strong> — plain CSV with all enriched columns, regardless of input
          format.
        </P>
        <P>
          <strong>Mihari-ready CSV</strong> — a slim two-column file (<code>entity_name</code>,{" "}
          <code>nzbn</code>) of just the matched rows, ready to drop into Mihari&rsquo;s
          bulk upload.
        </P>
      </Section>
    </InfoPage>
  );
}
