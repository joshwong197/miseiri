// Stateless per-row matching endpoint. Browser bulk uploader calls
// this in a client-side loop. Logic lives in src/lib/dispatch.ts so
// the MCP server can share it.

import { NextRequest, NextResponse } from "next/server";
import { matchOne } from "@/lib/dispatch";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const enriched = await matchOne(body as Parameters<typeof matchOne>[0]);
  // Always 200 — the UI reads body.nzbn_status, not the HTTP status.
  return NextResponse.json(enriched);
}
