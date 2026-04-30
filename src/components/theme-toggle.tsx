"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

// Two-state toggle: light ↔ dark. The label uses a kanji that hints at
// the current mode (光 light, 闇 dark).
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // Hydration-safe mount flag — the resolved theme is only known
  // post-hydration, so we render a placeholder on the server pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return <span style={{ width: 64, height: 28, display: "inline-block" }} aria-hidden />;

  // Treat "system" as whichever resolved theme is currently active so the
  // first click flips to the explicit opposite, not back to system.
  const current = (theme === "system" ? resolvedTheme : theme) ?? "light";
  const next = current === "light" ? "dark" : "light";
  const kanji = current === "light" ? "光" : "闇";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${current}. Click for ${next}.`}
      title={`Switch to ${next}`}
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
      <span style={{ letterSpacing: "0.04em", textTransform: "lowercase" }}>{current}</span>
    </button>
  );
}
