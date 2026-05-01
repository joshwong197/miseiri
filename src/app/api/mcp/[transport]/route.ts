// Miseiri's MCP server — exposes the NZBN matching engine as tools any
// MCP client (Claude Desktop, Cursor, Claude Code) can call. Public, no
// auth, same proxy pattern as the browser uploader: only the entity
// name / NZBN / company number leaves the client, the NZBN API key
// stays server-side.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { matchOne } from "@/lib/dispatch";

// Field-group toggles that the bulk uploader exposes. Default is
// "identity + addresses + trading names + contact + industry" — the
// free-from-the-NZBN-record set. Users can opt in to the +1-call extras.
const FIELDS_DEFAULT = {
  tradingNames: true,
  addresses: true,
  contact: true,
  industry: true,
  gst: false,
  directors: false,
  shareholders: false,
} as const;

const FieldsSchema = z.object({
  tradingNames: z.boolean().optional(),
  addresses: z.boolean().optional(),
  contact: z.boolean().optional(),
  industry: z.boolean().optional(),
  gst: z.boolean().optional(),
  directors: z.boolean().optional(),
  shareholders: z.boolean().optional(),
}).optional();

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "lookup_nzbn",
      [
        "Look up a New Zealand business by its 13-digit NZBN. Returns the canonical legal name, status, type, addresses, and other registered details.",
        "Pass `name` too when you have one — the tool will sanity-check the resolved entity against it and return status='needs_review' if the NZBN resolves to a clearly different company (wrong NZBN in customer ledgers is common; trusting it blindly is the worst silent failure).",
      ].join(" "),
      {
        nzbn: z.string().regex(/^\d{13}$/, "NZBN must be exactly 13 digits"),
        name: z.string().optional().describe("Optional row name. When provided, the resolved entity is sanity-checked against it; mismatches are flagged as needs_review."),
        fields: FieldsSchema,
      },
      async ({ nzbn, name, fields }) => {
        const result = await matchOne({ nzbn, name, fields: { ...FIELDS_DEFAULT, ...(fields ?? {}) } });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    );

    server.tool(
      "match_name",
      [
        "Resolve a free-text NZ business name to an NZBN entity. Handles typos, missing suffixes, abbreviations (COMM↔COMMERCIAL etc.), and trading-name matches.",
        "Returns status (matched / needs_review / not_found / error), the matched legal name and NZBN, a confidence score (0-1), and up to 5 alternative candidates when ambiguous.",
        "How to interpret results:",
        "• matched with confidence ≥0.85 — trust it.",
        "• needs_review — DO NOT pick a candidate silently. Surface the candidates to the user and ask which one (or whether none fit). Watch for these patterns: (1) sibling cluster — top candidates share a stem like 'X HOLDINGS / X PROPERTY / X INTERNATIONAL', meaning the bare parent doesn't exist; ask the user for invoice address or contact context. (2) duplicate registry entries — near-identical names with different NZBNs, usually statutory body vs company vehicle vs successor. (3) input ends in a preposition ('OF', 'AND', '&') — likely truncated; ask the user for the full name.",
        "• not_found — try once more with `threshold: 0.5` to surface weak candidates the user can confirm. If still empty, the entity may be a sole trader (no NZBN) or trading under a different legal name.",
        "Pass `nzbn` if you already know it — same sanity-check behaviour as lookup_nzbn.",
      ].join(" "),
      {
        name: z.string().min(1, "name required"),
        nzbn: z.string().regex(/^\d{13}$/).optional().describe("Optional NZBN. If supplied, used as primary key with name-based sanity check; falls back to name search on 4xx."),
        company_number: z.string().optional().describe("Optional Companies Office number to disambiguate when the name is fuzzy."),
        threshold: z.number().min(0.5).max(1).optional().describe("Auto-match confidence cutoff. Default 0.85 (default mode). Use 0.5 for an exploratory second pass on rows that came back not_found or that look truncated/garbled — surfaces weaker candidates for the user to choose from. Stay at 0.85+ for clean inputs where you only want confident matches."),
        fields: FieldsSchema,
      },
      async ({ name, nzbn, company_number, threshold, fields }) => {
        const result = await matchOne({
          name,
          nzbn,
          companyNumber: company_number,
          matchThreshold: threshold,
          fields: { ...FIELDS_DEFAULT, ...(fields ?? {}) },
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    );

    server.tool(
      "match_batch",
      [
        "Resolve many rows at once (cap 100). Each row runs the same matching ladder as match_name and the result array is in input order.",
        "Recommended workflow: run the batch at the default threshold first, then for any rows that came back not_found or needs_review, re-run those individually via match_name with `threshold: 0.5` to surface weaker candidates. Don't auto-pick from the second pass — present candidates to the user.",
      ].join(" "),
      {
        rows: z.array(z.object({
          name: z.string().optional(),
          nzbn: z.string().optional(),
          company_number: z.string().optional(),
        })).min(1).max(100),
        threshold: z.number().min(0.5).max(1).optional().describe("Auto-match cutoff applied to every row. Default 0.85. See match_name for guidance on strict (0.85+) vs default (0.65) vs exploratory (0.5)."),
        fields: FieldsSchema,
      },
      async ({ rows, threshold, fields }) => {
        const f = { ...FIELDS_DEFAULT, ...(fields ?? {}) };
        // Sequential processing — NZBN politeness. Same pattern as the browser loop.
        const results = [] as Awaited<ReturnType<typeof matchOne>>[];
        for (const row of rows) {
          results.push(await matchOne({
            name: row.name,
            nzbn: row.nzbn,
            companyNumber: row.company_number,
            matchThreshold: threshold,
            fields: f,
          }));
        }
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      },
    );
  },
  {
    // Server metadata; per-tool descriptions live on each .tool() call above.
    serverInfo: { name: "miseiri", version: "0.2.0" },
  },
  {
    // basePath must match the parent route folder so SSE / streamable-HTTP
    // sub-paths resolve correctly.
    basePath: "/api/mcp",
    verboseLogs: false,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
