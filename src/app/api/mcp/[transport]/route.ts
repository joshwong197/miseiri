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
      "Look up a New Zealand business by its 13-digit NZBN. Returns the canonical legal name, status, type, addresses, and other registered details.",
      {
        nzbn: z.string().regex(/^\d{13}$/, "NZBN must be exactly 13 digits"),
        fields: FieldsSchema,
      },
      async ({ nzbn, fields }) => {
        const result = await matchOne({ nzbn, fields: { ...FIELDS_DEFAULT, ...(fields ?? {}) } });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    );

    server.tool(
      "match_name",
      "Resolve a free-text NZ business name to an NZBN entity. Handles typos, missing suffixes, and trading-name matches. Returns status (matched / needs_review / not_found / error), the matched legal name and NZBN, a confidence score, and up to 5 alternative candidates when ambiguous.",
      {
        name: z.string().min(1, "name required"),
        company_number: z.string().optional().describe("Optional Companies Office number to disambiguate when the name is fuzzy"),
        threshold: z.number().min(0.5).max(1).optional().describe("Auto-match confidence cutoff (default 0.85). Below this the result is needs_review with candidates."),
        fields: FieldsSchema,
      },
      async ({ name, company_number, threshold, fields }) => {
        const result = await matchOne({
          name,
          companyNumber: company_number,
          matchThreshold: threshold,
          fields: { ...FIELDS_DEFAULT, ...(fields ?? {}) },
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    );

    server.tool(
      "match_batch",
      "Resolve many names at once. Each row runs the same matching ladder as match_name. Returns an array of enriched rows in the same order as the input. Cap is 100 rows per call to keep response sizes sensible.",
      {
        rows: z.array(z.object({
          name: z.string().optional(),
          nzbn: z.string().optional(),
          company_number: z.string().optional(),
        })).min(1).max(100),
        threshold: z.number().min(0.5).max(1).optional(),
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
