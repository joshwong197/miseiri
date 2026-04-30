"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

// Three-state toggle: light → dark → system → light. The label uses a
// kanji that hints at the current mode (光 light, 闇 dark, 自 system).
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // Hydration-safe mount flag. setState-in-effect is the standard pattern
  // for "render-only-after-mount" since the resolved theme is only known
  // post-hydration; React 19's lint flags it but this is the recommended
  // escape hatch from the next-themes docs.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // SSR-safe: render a placeholder so the layout doesn't shift on hydrate.
  if (!mounted) return <span style={{ width: 56, height: 28, display: "inline-block" }} aria-hidden />;

  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const kanji = theme === "system" ? "自" : theme === "light" ? "光" : "闇";
  const label = theme === "system" ? `system (${resolvedTheme})` : theme;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${label}. Click for ${next}.`}
      title={`Theme: ${label}. Click for ${next}.`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        background: "transparent",
        border: "1px solid var(--rule)",
        color: "var(--ink-dim)",
        fontFamily: "var(--font-gothic)",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      <span lang="ja" style={{ fontFamily: "var(--font-mincho)", fontSize: 14, color: "var(--ink)" }}>
        {kanji}
      </span>
      <span style={{ letterSpacing: "0.04em", textTransform: "lowercase" }}>{theme === "system" ? "auto" : theme}</span>
    </button>
  );
}
