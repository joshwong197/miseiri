// Shared layout primitive for info pages — masthead with kanji eyebrow,
// then a series of numbered sections. Server-rendered, no client state.

import * as React from "react";
import { Label } from "./label";

export function InfoPage({
  num,
  jp,
  eyebrow,
  title,
  intro,
  children,
}: {
  num: string;
  jp: string;
  eyebrow: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "64px 24px 96px" }}>
      <header style={{ marginBottom: 56 }}>
        <div style={{ marginBottom: 20 }}>
          <Label num={num} jp={jp}>{eyebrow}</Label>
        </div>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(40px, 6vw, 64px)",
            fontWeight: 300,
            letterSpacing: "-0.025em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--ink)",
          }}
        >
          {title}
        </h1>
        {intro && (
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              color: "var(--ink-dim)",
              lineHeight: 1.65,
              marginTop: 24,
              maxWidth: 720,
            }}
          >
            {intro}
          </p>
        )}
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>{children}</div>
    </main>
  );
}

export function Section({
  num,
  jp,
  title,
  children,
}: {
  num: string;
  jp: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ marginBottom: 20 }}>
        <Label num={num} jp={jp}>{title}</Label>
      </div>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 17,
          lineHeight: 1.7,
          color: "var(--ink)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontFamily: "var(--font-serif)",
        fontSize: 22,
        fontWeight: 400,
        letterSpacing: "-0.01em",
        margin: "32px 0 12px",
      }}
    >
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0 0 16px", color: "var(--ink-dim)" }}>{children}</p>;
}

export function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
        fontSize: 13,
        background: "var(--panel)",
        border: "1px solid var(--rule-soft)",
        padding: "16px 18px",
        overflow: "auto",
        lineHeight: 1.55,
        margin: "12px 0 24px",
        color: "var(--ink)",
      }}
    >
      {children}
    </pre>
  );
}
