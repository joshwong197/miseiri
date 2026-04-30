// Eyebrow label per Mihari design system: italic numeral + mincho kanji
// + short rule + gothic title. Used at the top of every section and page.

import * as React from "react";

export function Label({
  num,
  jp,
  children,
  color,
}: {
  num?: string;
  jp?: string;
  children: React.ReactNode;
  color?: string;
}) {
  const c = color ?? "var(--ink-dim)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: "var(--font-gothic)",
        fontSize: 12,
        color: c,
        letterSpacing: "0.02em",
        fontWeight: 500,
      }}
    >
      {num && (
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 22,
            lineHeight: 1,
            color: c,
          }}
        >
          {num}
        </span>
      )}
      {jp && (
        <span
          lang="ja"
          style={{
            fontFamily: "var(--font-mincho)",
            fontSize: 14,
            letterSpacing: "0.25em",
            fontWeight: 500,
          }}
        >
          {jp}
        </span>
      )}
      <span style={{ width: 24, height: 1, background: color ?? "var(--rule)" }} />
      <span>{children}</span>
    </div>
  );
}
