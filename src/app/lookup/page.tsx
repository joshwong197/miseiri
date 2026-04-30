"use client";

// Single-name lookup mode. Same matching engine as the bulk flow, just
// one name in, one result out. For the casual user with one company to
// verify and no spreadsheet.

import { useState } from "react";
import { tokenDiff } from "@/lib/diff";

type Status = "idle" | "loading" | "matched" | "needs_review" | "not_found" | "error";

interface Candidate { nzbn: string; entityName: string; score: number }

interface Result {
  nzbn_status: Status;
  nzbn_id?: string;
  legal_name?: string;
  entity_type?: string;
  entity_status?: string;
  trading_names?: string;
  registered_address?: string;
  confidence?: number;
  match_method?: string;
  candidates?: Candidate[];
  error_message?: string;
}

export default function LookupPage() {
  const [name, setName] = useState("");
  const [nzbn, setNzbn] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);

  const submit = async (forceNzbn?: string) => {
    const queryName = name.trim();
    const queryNzbn = (forceNzbn ?? nzbn).replace(/\s+/g, "");
    if (!queryName && !queryNzbn) return;
    setStatus("loading");
    setResult(null);
    try {
      const res = await fetch("/api/match-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: queryName || undefined,
          nzbn: queryNzbn || undefined,
          fields: { tradingNames: true, addresses: true, contact: true, industry: true, gst: false, directors: false, shareholders: false },
        }),
      });
      const data = (await res.json()) as Result;
      setResult(data);
      setStatus(data.nzbn_status ?? "error");
    } catch (err) {
      setResult({ nzbn_status: "error", error_message: String(err) });
      setStatus("error");
    }
  };

  const reset = () => {
    setName("");
    setNzbn("");
    setStatus("idle");
    setResult(null);
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" }}>
      <header style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
          <span lang="ja" style={{ fontFamily: "var(--font-mincho)", fontSize: 14, letterSpacing: "0.25em", color: "var(--ink-dim)" }}>
            二 · 件
          </span>
          <span style={{ width: 24, height: 1, background: "var(--rule)" }} />
          <span style={{ fontFamily: "var(--font-gothic)", fontSize: 12, color: "var(--ink-dim)", letterSpacing: "0.02em" }}>
            Single-name lookup
          </span>
        </div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 44, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1.05, margin: 0 }}>
          One name. <em style={{ color: "var(--ai)" }}>One answer.</em>
        </h1>
        <p style={{ fontFamily: "var(--font-serif)", color: "var(--ink-dim)", marginTop: 14, lineHeight: 1.6 }}>
          Same matching engine as the bulk flow — name or NZBN in, the registered identity out.
        </p>
      </header>

      <div style={{ display: "grid", gap: 12 }}>
        <label>
          <div style={labelStyle}>Entity name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())}
            placeholder="ABC Holdings"
            autoFocus
            style={inputStyle}
          />
        </label>
        <label>
          <div style={labelStyle}>NZBN <span style={{ color: "var(--ink-faint)" }}>· optional, 13 digits</span></div>
          <input
            value={nzbn}
            onChange={(e) => setNzbn(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())}
            placeholder="9429000000000"
            style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => submit()} disabled={status === "loading" || (!name.trim() && !nzbn.trim())} style={btnPrimary}>
            {status === "loading" ? "Looking up…" : "Look up"}
          </button>
          {(result || name || nzbn) && (
            <button onClick={reset} style={btnSecondary}>Reset</button>
          )}
        </div>
      </div>

      {result && (
        <ResultPanel result={result} inputName={name.trim()} onPickCandidate={(c) => submit(c)} />
      )}
    </main>
  );
}

function ResultPanel({ result, inputName, onPickCandidate }: { result: Result; inputName: string; onPickCandidate: (nzbn: string) => void }) {
  const s = result.nzbn_status;
  return (
    <section style={{ marginTop: 32, border: "1px solid var(--rule)", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: statusColor(s), letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {label(s)}
        </div>
        {result.confidence !== undefined && s === "matched" && (
          <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>confidence {Math.round((result.confidence ?? 0) * 100)}%</div>
        )}
      </div>

      {result.legal_name && (
        <h2 style={{ fontSize: 24, fontWeight: 500, margin: "12px 0 4px" }}>{result.legal_name}</h2>
      )}
      {result.nzbn_id && (
        <div style={{ color: "var(--ink-dim)", fontFamily: "var(--font-gothic, monospace)", fontSize: 13 }}>NZBN {result.nzbn_id}</div>
      )}

      {s === "matched" && inputName && result.legal_name && (
        <DiffBlock input={inputName} matched={result.legal_name} />
      )}

      {s === "matched" && (
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", marginTop: 20, fontSize: 14 }}>
          {result.entity_type && <Row label="Type" value={result.entity_type} />}
          {result.entity_status && <Row label="Status" value={result.entity_status} />}
          {result.trading_names && <Row label="Trading names" value={result.trading_names} />}
          {result.registered_address && <Row label="Registered" value={result.registered_address} />}
          {result.match_method && <Row label="Method" value={result.match_method} />}
        </dl>
      )}

      {(s === "needs_review" || s === "not_found") && result.candidates && result.candidates.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "var(--ink-dim)", marginBottom: 8 }}>
            {s === "needs_review" ? "Best candidates:" : "Closest matches:"}
          </div>
          <div style={{ border: "1px solid var(--rule-soft)" }}>
            {result.candidates.map((c) => (
              <div key={c.nzbn} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--rule-soft)", gap: 12 }}>
                <div style={{ flex: 1 }}>{c.entityName}</div>
                <div style={{ color: "var(--ink-dim)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>NZBN {c.nzbn}</div>
                <div style={{ color: "var(--ink-dim)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{c.score.toFixed(2)}</div>
                <button onClick={() => onPickCandidate(c.nzbn)} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 12 }}>
                  Use this
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {s === "error" && result.error_message && (
        <div style={{ marginTop: 12, color: "var(--red)", fontSize: 13 }}>{result.error_message}</div>
      )}
    </section>
  );
}

function DiffBlock({ input, matched }: { input: string; matched: string }) {
  const { left, right } = tokenDiff(input, matched);
  return (
    <div style={{ marginTop: 14, fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.6 }}>
      <div><span style={{ display: "inline-block", width: 64 }}>your input</span>{render(left, "removed")}</div>
      <div><span style={{ display: "inline-block", width: 64 }}>register</span>{render(right, "added")}</div>
    </div>
  );
}

function render(parts: { text: string; kind: "same" | "removed" | "added" }[], otherSide: "removed" | "added") {
  return parts.map((p, i) => {
    const next = parts[i + 1]?.text;
    const space = !next ? "" : (/^[^A-Za-z0-9']+$/.test(next) || /^[^A-Za-z0-9']+$/.test(p.text)) ? "" : " ";
    if (p.kind === "same") return <span key={i} style={{ color: "var(--ink-dim)" }}>{p.text}{space}</span>;
    const color = otherSide === "removed" ? "var(--red)" : "var(--green)";
    const bg = otherSide === "removed" ? "rgba(184,47,33,0.15)" : "rgba(46,125,50,0.15)";
    const decoration = p.kind === "removed" ? "line-through" : "none";
    return <span key={i} style={{ background: bg, color, textDecoration: decoration }}>{p.text}{space}</span>;
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: "var(--ink-dim)", fontSize: 12 }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </>
  );
}

function statusColor(s: Status): string {
  return s === "matched" ? "var(--green)" : s === "needs_review" ? "var(--amber)" : s === "error" ? "var(--red)" : "var(--ink-dim)";
}

function label(s: Status): string {
  switch (s) {
    case "loading": return "Looking up";
    case "matched": return "Matched";
    case "needs_review": return "Needs review";
    case "not_found": return "Not found";
    case "error": return "Error";
    default: return "";
  }
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  border: "1px solid var(--rule)",
  background: "white",
  color: "var(--ink)",
  fontSize: 16,
  outline: "none",
};
const btnPrimary: React.CSSProperties = {
  padding: "12px 22px",
  background: "var(--ink)",
  color: "var(--bg)",
  border: "1px solid var(--ink)",
  fontSize: 14,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "12px 22px",
  background: "transparent",
  color: "var(--ink)",
  border: "1px solid var(--rule)",
  fontSize: 14,
  cursor: "pointer",
};
