"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

const NAV: { href: string; jp: string; label: string }[] = [
  { href: "/", jp: "載", label: "Upload" },
  { href: "/lookup", jp: "索", label: "Single Lookup" },
  { href: "/about", jp: "概", label: "About" },
  { href: "/how-it-works", jp: "構", label: "How it works" },
  { href: "/mcp", jp: "接", label: "MCP" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <header
      style={{
        borderBottom: "1px solid var(--rule)",
        background: "var(--bg)",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "16px 24px",
          display: "flex",
          alignItems: "baseline",
          gap: 32,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 10,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              fontSize: 22,
              letterSpacing: "-0.015em",
            }}
          >
            Miseiri
          </span>
          <span
            lang="ja"
            style={{
              fontFamily: "var(--font-mincho)",
              fontSize: 14,
              letterSpacing: "0.18em",
              color: "var(--ink-dim)",
            }}
          >
            見整理
          </span>
        </Link>

        <nav style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 8,
                  fontFamily: "var(--font-gothic)",
                  fontSize: 13,
                  textDecoration: "none",
                  color: active ? "var(--ink)" : "var(--ink-dim)",
                  borderBottom: active ? "1px solid var(--ai)" : "1px solid transparent",
                  paddingBottom: 2,
                }}
              >
                <span
                  lang="ja"
                  style={{
                    fontFamily: "var(--font-mincho)",
                    fontSize: 12,
                    letterSpacing: "0.18em",
                    color: active ? "var(--ai)" : "var(--ink-faint)",
                  }}
                >
                  {item.jp}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginLeft: "auto" }}>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
