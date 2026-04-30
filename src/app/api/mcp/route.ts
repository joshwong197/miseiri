// Redirect /api/mcp → /api/mcp/mcp (streamable HTTP transport).
// The actual handler lives under [transport]/route.ts; this lets users
// paste the shorter URL into MCP client configs.

import { NextRequest, NextResponse } from "next/server";

function redirect(req: NextRequest) {
  const url = new URL(req.url);
  url.pathname = "/api/mcp/mcp";
  return NextResponse.redirect(url, 307);
}

export const GET = redirect;
export const POST = redirect;
export const DELETE = redirect;
