"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { normalizeForCompare } from "@/lib/match/normalize";

type Stage = "upload" | "map" | "fields" | "process" | "done";
type RowStatus = "pending" | "processing" | "matched" | "needs_review" | "not_found" | "error" | "rejected";
type Filter = "all" | "matched" | "needs_review" | "not_found" | "error" | "rejected";

interface ParsedRow { [key: string]: string }

interface ColumnMap {
  name: string | null;
  nzbn: string | null;
  companyNumber: string | null;
}

interface FieldGroups {
  tradingNames: boolean;
  addresses: boolean;
  contact: boolean;
  industry: boolean;
  gst: boolean;
  directors: boolean;
  shareholders: boolean;
}

interface RowResult {
  index: number;
  status: RowStatus;
  enriched?: Record<string, unknown>;
  error?: string;
}

const ROW_DELAY_MS = 120;
const MAX_ROWS = 10_000;
const WARN_ROWS = 2_000;

export default function HomePage() {
  const [stage, setStage] = useState<Stage>("upload");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [columnMap, setColumnMap] = useState<ColumnMap>({ name: null, nzbn: null, companyNumber: null });
  const [fieldGroups, setFieldGroups] = useState<FieldGroups>({
    tradingNames: true,
    addresses: true,
    contact: false,
    industry: false,
    gst: false,
    directors: false,
    shareholders: false,
  });
  const [matchThreshold, setMatchThreshold] = useState(0.85);
  const [results, setResults] = useState<RowResult[]>([]);
  const [progressIdx, setProgressIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  // Original Excel workbook is preserved when the user uploads .xlsx so
  // the download can append columns without rewriting the source cells —
  // this keeps original cell formatting, formulas, and other sheets intact.
  const originalWorkbookRef = useRef<XLSX.WorkBook | null>(null);
  // Per-row dedupe key (normalized name) computed once at upload. Rows
  // sharing the same key are processed once; the result is propagated.
  const dedupeKeysRef = useRef<string[]>([]);

  const parseFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let parsed: ParsedRow[] = [];
        let hdrs: string[] = [];
        if (file.name.endsWith(".json")) {
          const json = JSON.parse(e.target!.result as string);
          const items = Array.isArray(json) ? json : json.items ?? json.entities ?? [];
          parsed = items.map((it: Record<string, unknown>) => {
            const obj: ParsedRow = {};
            for (const [k, v] of Object.entries(it)) obj[k] = v == null ? "" : String(v);
            return obj;
          });
          hdrs = parsed.length > 0 ? Object.keys(parsed[0]) : [];
        } else if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array", cellStyles: true });
          originalWorkbookRef.current = wb;
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { defval: "" }) as ParsedRow[];
          parsed = json;
          hdrs = parsed.length > 0 ? Object.keys(parsed[0]) : [];
        } else {
          originalWorkbookRef.current = null;
          const text = e.target!.result as string;
          const result = Papa.parse<ParsedRow>(text, { header: true, skipEmptyLines: true });
          parsed = result.data.filter((r) => Object.values(r).some((v) => v && String(v).trim()));
          hdrs = result.meta.fields ?? [];
        }

        if (parsed.length === 0) {
          alert("No rows found in file.");
          return;
        }
        if (parsed.length > MAX_ROWS) {
          alert(`Maximum ${MAX_ROWS.toLocaleString()} rows per file. Yours has ${parsed.length.toLocaleString()}.`);
          return;
        }

        setRows(parsed);
        setHeaders(hdrs);
        // Pre-fill column guesses
        const guess = (patterns: RegExp[]) => hdrs.find((h) => patterns.some((p) => p.test(h))) ?? null;
        setColumnMap({
          name: guess([/name/i, /entity/i, /company/i]),
          nzbn: guess([/^nzbn$/i, /\bnzbn\b/i]),
          companyNumber: guess([/company.?number/i, /^cn$/i, /\bcompany.?no\b/i]),
        });
        setStage("map");
      } catch (err) {
        alert("Failed to parse file: " + String(err));
      }
    };
    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) parseFile(f);
  };

  const estTimePerRow = useMemo(() => {
    let calls = 1;
    if (fieldGroups.gst) calls++;
    if (fieldGroups.directors) calls++;
    if (fieldGroups.shareholders) calls++;
    return calls * 1.2; // ~1.2s per call rough average
  }, [fieldGroups]);

  const totalEst = useMemo(() => Math.ceil(rows.length * estTimePerRow), [rows.length, estTimePerRow]);

  // Process a single row. Used by the initial run, the retry button, and
  // the candidate-picker. `overrideNzbn` lets a manual pick bypass the
  // search step and look up directly.
  const processRow = async (index: number, overrideNzbn?: string): Promise<Record<string, unknown> | null> => {
    setResults((prev) => prev.map((r) => (r.index === index ? { ...r, status: "processing" } : r)));
    const row = rows[index];
    const payload = {
      name: columnMap.name ? row[columnMap.name] : "",
      nzbn: overrideNzbn ?? (columnMap.nzbn ? row[columnMap.nzbn] : undefined),
      companyNumber: columnMap.companyNumber ? row[columnMap.companyNumber] : undefined,
      fields: fieldGroups,
      matchThreshold,
    };
    try {
      const res = await fetch("/api/match-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const status = (data?.nzbn_status ?? "error") as RowStatus;
      setResults((prev) => prev.map((r) => (r.index === index ? { ...r, status, enriched: data } : r)));
      return data;
    } catch (err) {
      setResults((prev) => prev.map((r) => (r.index === index ? { ...r, status: "error", error: String(err) } : r)));
      return null;
    }
  };

  // Apply a previously-computed result to a row without hitting the API.
  // Used by dedupe propagation and "send to Mihari" inference.
  const applyCachedResult = (index: number, enriched: Record<string, unknown>) => {
    const status = (enriched.nzbn_status ?? "error") as RowStatus;
    setResults((prev) => prev.map((r) => (r.index === index ? { ...r, status, enriched } : r)));
  };

  const startProcessing = async () => {
    setStage("process");
    setResults(rows.map((_, i) => ({ index: i, status: "pending" as RowStatus })));
    setRunning(true);
    abortRef.current = false;
    pauseRef.current = false;

    // Compute dedupe keys now that the column mapping is settled.
    // Key prefers NZBN if present (most reliable), then company number,
    // then normalised entity name. Empty key means "always treat as
    // unique" — don't dedupe rows that have nothing to dedupe on.
    const keys = rows.map((row) => {
      const nzbn = (columnMap.nzbn && row[columnMap.nzbn] || "").toString().trim();
      if (nzbn) return `nzbn:${nzbn}`;
      const cn = (columnMap.companyNumber && row[columnMap.companyNumber] || "").toString().trim();
      if (cn) return `cn:${cn}`;
      const name = (columnMap.name && row[columnMap.name] || "").toString().trim();
      const norm = normalizeForCompare(name);
      return norm ? `name:${norm}` : "";
    });
    dedupeKeysRef.current = keys;

    // In-session dedupe: the same name appears multiple times in real
    // ledgers (one customer billed under several bill-to entities). We
    // process the first occurrence, then propagate to subsequent ones.
    const cache = new Map<string, Record<string, unknown>>();

    for (let i = 0; i < rows.length; i++) {
      if (abortRef.current) break;
      while (pauseRef.current && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (abortRef.current) break;

      setProgressIdx(i);

      const key = keys[i] ?? "";
      const cached = key ? cache.get(key) : undefined;
      if (cached) {
        // Mark as processing briefly for visual feedback, then apply.
        setResults((prev) => prev.map((r) => (r.index === i ? { ...r, status: "processing" } : r)));
        applyCachedResult(i, { ...cached, _from_cache: true });
      } else {
        const result = await processRow(i);
        if (result && key) cache.set(key, result);
        // Politeness delay only for real API calls.
        if (i < rows.length - 1 && !abortRef.current) {
          await new Promise((r) => setTimeout(r, ROW_DELAY_MS));
        }
      }
    }

    setRunning(false);
    setStage("done");
  };

  const retryIndices = async (indices: number[]) => {
    if (indices.length === 0) return;
    setRunning(true);
    abortRef.current = false;
    for (const idx of indices) {
      if (abortRef.current) break;
      setProgressIdx(idx);
      await processRow(idx);
      await new Promise((r) => setTimeout(r, ROW_DELAY_MS));
    }
    setRunning(false);
  };

  const togglePause = () => {
    pauseRef.current = !pauseRef.current;
    setPaused(pauseRef.current);
  };

  const stop = () => {
    abortRef.current = true;
    setRunning(false);
  };

  // Internal-only fields that exist on the result object for UI bookkeeping
  // but should never be exported to the user's spreadsheet.
  const INTERNAL_FIELDS = new Set(["candidates", "_from_cache", "error_message"]);

  const enrichedExportKeys = (): string[] => {
    const keys = new Set<string>();
    for (const r of results) {
      if (!r.enriched) continue;
      for (const k of Object.keys(r.enriched)) {
        if (!INTERNAL_FIELDS.has(k)) keys.add(k);
      }
    }
    return [...keys];
  };

  const downloadCsv = () => {
    const keys = enrichedExportKeys();
    const outRows = rows.map((row, i) => {
      const enriched = (results[i]?.enriched ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...row };
      for (const k of keys) merged[k] = enriched[k] ?? "";
      return merged;
    });

    const csv = Papa.unparse(outRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.[^.]+$/, "") + "_cleansed.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Append enrichment columns to the original Excel workbook, preserving
  // existing cell formatting and any other sheets the user had. If the
  // upload was CSV (no original workbook), build a fresh xlsx instead.
  const downloadExcel = () => {
    const keys = enrichedExportKeys();
    const fileBase = fileName.replace(/\.[^.]+$/, "");

    let wb: XLSX.WorkBook;
    let firstSheet: string;

    if (originalWorkbookRef.current) {
      // Append columns to the original sheet at the right edge.
      wb = originalWorkbookRef.current;
      firstSheet = wb.SheetNames[0];
      const ws = wb.Sheets[firstSheet];
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      const startCol = range.e.c + 1;

      const data: (string | number | null)[][] = [keys];
      for (let i = 0; i < rows.length; i++) {
        const enriched = (results[i]?.enriched ?? {}) as Record<string, unknown>;
        data.push(keys.map((k) => {
          const v = enriched[k];
          if (v === null || v === undefined) return "";
          if (typeof v === "number" || typeof v === "string") return v;
          return String(v);
        }));
      }
      XLSX.utils.sheet_add_aoa(ws, data, { origin: { r: 0, c: startCol } });

      const newRange = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      newRange.e.c = startCol + keys.length - 1;
      newRange.e.r = Math.max(newRange.e.r, rows.length);
      ws["!ref"] = XLSX.utils.encode_range(newRange);
    } else {
      // CSV-source: build a fresh workbook from the merged rows.
      wb = XLSX.utils.book_new();
      const outRows = rows.map((row, i) => {
        const enriched = (results[i]?.enriched ?? {}) as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...row };
        for (const k of keys) merged[k] = enriched[k] ?? "";
        return merged;
      });
      const ws = XLSX.utils.json_to_sheet(outRows);
      firstSheet = "Sheet1";
      XLSX.utils.book_append_sheet(wb, ws, firstSheet);
    }

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileBase + "_cleansed.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  // A minimal CSV with just the matched NZBNs — ready to paste into
  // Mihari's bulk upload. Skips rows that didn't resolve.
  const downloadMihariCsv = () => {
    const out: { entity_name: string; nzbn: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = results[i];
      const enriched = r?.enriched as { nzbn_id?: string; legal_name?: string } | undefined;
      if (r?.status === "matched" && enriched?.nzbn_id) {
        out.push({ entity_name: enriched.legal_name ?? "", nzbn: enriched.nzbn_id });
      }
    }
    if (out.length === 0) {
      alert("No matched rows to send. Resolve some rows first.");
      return;
    }
    const csv = Papa.unparse(out);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.[^.]+$/, "") + "_mihari.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = useMemo(() => ({
    matched: results.filter((r) => r.status === "matched").length,
    review: results.filter((r) => r.status === "needs_review").length,
    notFound: results.filter((r) => r.status === "not_found").length,
    error: results.filter((r) => r.status === "error").length,
    rejected: results.filter((r) => r.status === "rejected").length,
    pending: results.filter((r) => r.status === "pending").length,
    processing: results.filter((r) => r.status === "processing").length,
  }), [results]);

  const rejectRow = (index: number) => {
    setResults((prev) => prev.map((r) => {
      if (r.index !== index) return r;
      // Preserve only the candidates so the user can still pick a
      // different one after rejecting. Everything else is cleared so
      // the downloaded CSV won't carry the wrong match.
      const enrichedAny = r.enriched as { candidates?: unknown } | undefined;
      const candidates = enrichedAny?.candidates;
      return {
        ...r,
        status: "rejected",
        enriched: candidates ? ({ candidates } as Record<string, unknown>) : undefined,
      };
    }));
  };

  const completedCount = results.length - counts.pending - counts.processing;
  const pct = results.length === 0 ? 0 : Math.round((completedCount / results.length) * 100);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px 96px" }}>
      <header style={{ marginBottom: 48 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
            Miseiri
          </h1>
          <span lang="ja" style={{ fontSize: 22, letterSpacing: "0.18em", color: "var(--ink-dim)" }}>
            見整理
          </span>
        </div>
        <p style={{ color: "var(--ink-dim)", marginTop: 8, maxWidth: 640 }}>
          Upload a spreadsheet of customer or supplier names. Miseiri resolves each one against the
          New Zealand Business Number register and returns your file enriched with authoritative
          identity data. Free, runs in your browser, no data stored.
        </p>
      </header>

      <Stepper stage={stage} />

      {stage === "upload" && (
        <UploadStage
          fileInputRef={fileInputRef}
          onFile={onFile}
          onDrop={onDrop}
        />
      )}

      {stage === "map" && (
        <MapStage
          rows={rows}
          headers={headers}
          fileName={fileName}
          columnMap={columnMap}
          setColumnMap={setColumnMap}
          onBack={() => setStage("upload")}
          onNext={() => setStage("fields")}
        />
      )}

      {stage === "fields" && (
        <FieldsStage
          rowCount={rows.length}
          totalEst={totalEst}
          groups={fieldGroups}
          setGroups={setFieldGroups}
          threshold={matchThreshold}
          setThreshold={setMatchThreshold}
          onBack={() => setStage("map")}
          onStart={startProcessing}
        />
      )}

      {(stage === "process" || stage === "done") && (
        <ProcessStage
          rows={rows}
          columnMap={columnMap}
          results={results}
          progressIdx={progressIdx}
          counts={counts}
          pct={pct}
          running={running}
          paused={paused}
          onPauseResume={togglePause}
          onStop={stop}
          onDownload={downloadCsv}
          onDownloadExcel={downloadExcel}
          onDownloadMihari={downloadMihariCsv}
          hasOriginalExcel={!!originalWorkbookRef.current}
          onRetry={retryIndices}
          onPickCandidate={(idx, nzbn) => processRow(idx, nzbn).then(() => {})}
          onReject={rejectRow}
          onStartOver={() => {
            const ok = window.confirm(
              "Start a new file? Your current results will be cleared. Make sure you've downloaded the CSV if you want to keep them.",
            );
            if (!ok) return;
            setStage("upload");
            setRows([]);
            setResults([]);
            setHeaders([]);
            setFileName("");
            setColumnMap({ name: null, nzbn: null, companyNumber: null });
          }}
        />
      )}
    </main>
  );
}

function Stepper({ stage }: { stage: Stage }) {
  const steps: { id: Stage; label: string }[] = [
    { id: "upload", label: "Upload" },
    { id: "map", label: "Map columns" },
    { id: "fields", label: "Choose fields" },
    { id: "process", label: "Process" },
    { id: "done", label: "Download" },
  ];
  const active = steps.findIndex((s) => s.id === stage);
  return (
    <ol style={{ display: "flex", gap: 12, padding: 0, margin: "0 0 32px", listStyle: "none", flexWrap: "wrap" }}>
      {steps.map((s, i) => (
        <li
          key={s.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            border: `1px solid ${i <= active ? "var(--ink)" : "var(--rule)"}`,
            color: i <= active ? "var(--ink)" : "var(--ink-faint)",
            background: i === active ? "var(--ink)" : "transparent",
            ...(i === active ? { color: "var(--bg)" } : {}),
            fontSize: 13,
          }}
        >
          <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.6 }}>{i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function UploadStage({
  fileInputRef,
  onFile,
  onDrop,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <>
      <PrivacyPanel />
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          border: "1px dashed var(--rule)",
          padding: 64,
          textAlign: "center",
          background: "var(--panel)",
        }}
      >
        <h2 style={{ fontSize: 22, margin: "0 0 12px" }}>Drop your file here, or</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={btnPrimary}
        >
          Choose file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,.json"
          style={{ display: "none" }}
          onChange={onFile}
        />
        <p style={{ color: "var(--ink-dim)", marginTop: 28, fontSize: 13, lineHeight: 1.7 }}>
          CSV (recommended), TSV, Excel (.xlsx), or JSON. Header row in row 1.
          Up to {MAX_ROWS.toLocaleString()} rows.
        </p>
      </div>
    </>
  );
}

function PrivacyPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      border: "1px solid var(--rule)",
      background: "var(--bg)",
      padding: "20px 24px",
      marginBottom: 24,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span lang="ja" style={{ fontFamily: "var(--font-mincho, serif)", fontSize: 16, color: "var(--ink-dim)", letterSpacing: "0.18em" }}>
          安心
        </span>
        <strong style={{ fontSize: 14 }}>Your file stays on your computer.</strong>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, marginLeft: "auto", padding: 0 }}
        >
          {open ? "Hide details" : "What we send →"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: "var(--ink)" }}>Sent to the NZBN register only:</strong> the
            entity name, NZBN, or company number you map in the next step. Nothing else.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: "var(--ink)" }}>Read but never sent:</strong> every other column
            in your file — financials, customer codes, internal notes, addresses. Miseiri reads
            these once to display the preview, then passes them through to the output unchanged.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: "var(--ink)" }}>Never stored:</strong> nothing from your file is
            written to a database, logged on our server, or sent to any third party other than
            business.govt.nz (the official NZBN register). When you close the tab, it&rsquo;s gone.
          </p>
          <p style={{ margin: 0, color: "var(--ink-faint)" }}>
            The only third-party calls happen when matching: each row sends one entity name (or NZBN)
            to NZBN, and for some optional fields one or two follow-up lookups for that same entity.
          </p>
        </div>
      )}
    </div>
  );
}

function MapStage({
  rows,
  headers,
  fileName,
  columnMap,
  setColumnMap,
  onBack,
  onNext,
}: {
  rows: ParsedRow[];
  headers: string[];
  fileName: string;
  columnMap: ColumnMap;
  setColumnMap: (m: ColumnMap) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const preview = rows.slice(0, 5);
  const setField = (key: keyof ColumnMap) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setColumnMap({ ...columnMap, [key]: e.target.value || null });

  const canProceed = !!columnMap.name;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>{fileName}</h2>
          <div style={{ color: "var(--ink-dim)", fontSize: 13 }}>{rows.length.toLocaleString()} rows</div>
        </div>
      </div>

      <p style={{ color: "var(--ink-dim)", maxWidth: 720, marginBottom: 20 }}>
        Tell us which column holds the entity name (required). NZBN and Companies Office number are
        optional but make matching faster and more accurate when available.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 32 }}>
        <Picker label="Entity name" required value={columnMap.name} headers={headers} onChange={setField("name")} />
        <Picker label="NZBN" hint="13 digits" value={columnMap.nzbn} headers={headers} onChange={setField("nzbn")} />
        <Picker label="Company number" hint="Companies Office #" value={columnMap.companyNumber} headers={headers} onChange={setField("companyNumber")} />
      </div>

      <h3 style={{ fontSize: 14, color: "var(--ink-dim)", margin: "0 0 8px" }}>Preview (first 5 rows)</h3>
      <div style={{ overflowX: "auto", border: "1px solid var(--rule-soft)" }}>
        <table style={{ width: "100%", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--panel)" }}>
              {headers.map((h) => (
                <th key={h} style={{ ...thStyle, color: tagFor(columnMap, h) ? "var(--accent)" : "var(--ink-dim)" }}>
                  {h}
                  {tagFor(columnMap, h) && (
                    <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px", background: "var(--accent)", color: "white", borderRadius: 2 }}>
                      {tagFor(columnMap, h)}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i}>
                {headers.map((h) => (
                  <td key={h} style={tdStyle}>{row[h]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
        <button onClick={onBack} style={btnSecondary}>Back</button>
        <button onClick={onNext} disabled={!canProceed} style={{ ...btnPrimary, opacity: canProceed ? 1 : 0.4, cursor: canProceed ? "pointer" : "not-allowed" }}>
          Continue
        </button>
      </div>
    </div>
  );
}

function Picker({ label, required, hint, value, headers, onChange }: {
  label: string;
  required?: boolean;
  hint?: string;
  value: string | null;
  headers: string[];
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
        {label}{required && <span style={{ color: "var(--red)" }}> *</span>}
        {hint && <span style={{ color: "var(--ink-faint)" }}> · {hint}</span>}
      </div>
      <select value={value ?? ""} onChange={onChange} style={selectStyle}>
        <option value="">— none —</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );
}

function tagFor(map: ColumnMap, header: string): string | null {
  if (map.name === header) return "name";
  if (map.nzbn === header) return "nzbn";
  if (map.companyNumber === header) return "co.#";
  return null;
}

function FieldsStage({ rowCount, totalEst, groups, setGroups, threshold, setThreshold, onBack, onStart }: {
  rowCount: number;
  totalEst: number;
  groups: FieldGroups;
  setGroups: (g: FieldGroups) => void;
  threshold: number;
  setThreshold: (t: number) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const items: { key: keyof FieldGroups; label: string; sub: string; cost: string }[] = [
    { key: "tradingNames", label: "Trading names", sub: "All registered trading names", cost: "free" },
    { key: "addresses", label: "Addresses", sub: "Registered, postal, service", cost: "free" },
    { key: "contact", label: "Contact details", sub: "Phone, email, website (if published)", cost: "free" },
    { key: "industry", label: "Industry / ANZSIC", sub: "Classification codes", cost: "free" },
    { key: "gst", label: "GST", sub: "Registration status & number", cost: "+1 call/row" },
    { key: "directors", label: "Directors", sub: "Current director count and names", cost: "+1 call/row" },
    { key: "shareholders", label: "Shareholders", sub: "Group count, summary", cost: "+1 call/row" },
  ];

  const fmtTime = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return `${m}m ${rem}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  const showWarning = rowCount > WARN_ROWS;

  return (
    <div>
      <h2 style={{ margin: "0 0 8px" }}>What should we add?</h2>
      <p style={{ color: "var(--ink-dim)", maxWidth: 720, marginTop: 0 }}>
        Identity columns (NZBN, legal name, status, type) and a corrected legal name are always
        included. Tick the extras you want. Fewer ticks = faster.
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginTop: 20 }}>
        {items.map((it) => (
          <label key={it.key} style={{
            display: "flex",
            gap: 12,
            padding: "16px 18px",
            border: "1px solid var(--rule)",
            cursor: "pointer",
            background: groups[it.key] ? "var(--panel)" : "transparent",
          }}>
            <input
              type="checkbox"
              checked={groups[it.key]}
              onChange={(e) => setGroups({ ...groups, [it.key]: e.target.checked })}
              style={{ marginTop: 4 }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>{it.label}</div>
              <div style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 2 }}>{it.sub}</div>
              <div style={{ color: "var(--ink-faint)", fontSize: 11, marginTop: 6 }}>{it.cost}</div>
            </div>
          </label>
        ))}
      </div>

      <ThresholdSlider value={threshold} onChange={setThreshold} />

      <div style={{ marginTop: 32, padding: "16px 18px", background: "var(--panel)", border: "1px solid var(--rule)" }}>
        <div style={{ color: "var(--ink-dim)", fontSize: 13 }}>Estimated time for {rowCount.toLocaleString()} rows:</div>
        <div style={{ fontSize: 24, fontWeight: 500, marginTop: 4 }}>{fmtTime(totalEst)}</div>
        {showWarning && (
          <div style={{ color: "var(--amber)", fontSize: 13, marginTop: 8 }}>
            Heads up: {rowCount.toLocaleString()} rows will take a while. You can pause or stop at
            any time.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
        <button onClick={onBack} style={btnSecondary}>Back</button>
        <button onClick={onStart} style={btnPrimary}>Start matching</button>
      </div>
    </div>
  );
}

function ThresholdSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [showHelp, setShowHelp] = useState(false);
  const pct = Math.round(value * 100);
  const stance = value >= 0.9 ? "Strict"
    : value >= 0.8 ? "Balanced (recommended)"
    : value >= 0.7 ? "Permissive"
    : "Very permissive";

  return (
    <div style={{ marginTop: 32, padding: "20px 22px", border: "1px solid var(--rule)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 500 }}>Confidence threshold</div>
          <div style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 2 }}>
            Currently <strong>{pct}%</strong> · {stance}
          </div>
        </div>
        <button
          onClick={() => setShowHelp((s) => !s)}
          style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, padding: 0 }}
        >
          {showHelp ? "Hide examples" : "What does this mean?"}
        </button>
      </div>

      <input
        type="range"
        min={0.6}
        max={0.99}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", marginTop: 12 }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-faint)" }}>
        <span>60% — very permissive</span>
        <span>85% — balanced</span>
        <span>99% — strict</span>
      </div>

      {showHelp && (
        <div style={{ marginTop: 16, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 12px" }}>
            Above this threshold a row auto-matches; below it, the row is sent to{" "}
            <strong style={{ color: "var(--ink)" }}>Needs review</strong> for you to confirm.
            Lower the threshold to auto-match more aggressively, raise it to be cautious.
          </p>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              <tr style={{ borderTop: "1px solid var(--rule-soft)" }}>
                <td style={{ padding: "8px 0", width: 80 }}><strong>0.95+</strong></td>
                <td>Near-identical names only — &ldquo;Fonterra Cooperative Group Ltd&rdquo; → exact register match.</td>
              </tr>
              <tr style={{ borderTop: "1px solid var(--rule-soft)" }}>
                <td style={{ padding: "8px 0" }}><strong>0.85</strong></td>
                <td>Default. Catches typos and minor word differences. &ldquo;Fontera Cooperative Group&rdquo; → matched.</td>
              </tr>
              <tr style={{ borderTop: "1px solid var(--rule-soft)" }}>
                <td style={{ padding: "8px 0" }}><strong>0.75</strong></td>
                <td>Catches partial names. &ldquo;Fontera Cooperative&rdquo; → matched (missing &ldquo;Group&rdquo;).</td>
              </tr>
              <tr style={{ borderTop: "1px solid var(--rule-soft)" }}>
                <td style={{ padding: "8px 0" }}><strong>0.65</strong></td>
                <td>Quite loose — single shared word. Use only when you plan to manually review every match.</td>
              </tr>
            </tbody>
          </table>
          <p style={{ margin: "12px 0 0", color: "var(--ink-faint)", fontSize: 12 }}>
            Whatever the threshold, low-confidence candidates always show up in Needs review with the
            full candidate list — you never lose visibility.
          </p>
        </div>
      )}
    </div>
  );
}

function ProcessStage({
  rows, columnMap, results, progressIdx, counts, pct, running, paused,
  onPauseResume, onStop, onDownload, onDownloadExcel, onDownloadMihari, hasOriginalExcel,
  onStartOver, onRetry, onPickCandidate, onReject,
}: {
  rows: ParsedRow[];
  columnMap: ColumnMap;
  results: RowResult[];
  progressIdx: number;
  counts: { matched: number; review: number; notFound: number; error: number; rejected: number; pending: number; processing: number };
  pct: number;
  running: boolean;
  paused: boolean;
  onPauseResume: () => void;
  onStop: () => void;
  onDownload: () => void;
  onDownloadExcel: () => void;
  onDownloadMihari: () => void;
  hasOriginalExcel: boolean;
  onStartOver: () => void;
  onRetry: (indices: number[]) => Promise<void>;
  onPickCandidate: (rowIndex: number, nzbn: string) => Promise<void>;
  onReject: (rowIndex: number) => void;
}) {
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const filtered = useMemo(() => {
    if (filter === "all") return results;
    return results.filter((r) => r.status === filter);
  }, [filter, results]);

  const filteredIndices = useMemo(() => filtered.map((r) => r.index), [filtered]);

  const inputNameFor = (rowIndex: number) =>
    (columnMap.name && rows[rowIndex]?.[columnMap.name]) || Object.values(rows[rowIndex] ?? {})[0] || "";

  const canRetry = filter === "error" || filter === "not_found" || filter === "rejected";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{running ? `Processing row ${progressIdx + 1} of ${rows.length}` : "Done"}</h2>
          <div style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 4 }}>
            {paused ? "Paused" : running ? "Working through your file…" : "Review the results below."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {running && (
            <>
              <button onClick={onPauseResume} style={btnSecondary}>{paused ? "Resume" : "Pause"}</button>
              <button onClick={onStop} style={{ ...btnSecondary, borderColor: "var(--red)", color: "var(--red)" }}>Stop</button>
            </>
          )}
          {!running && (
            <>
              <div style={{ position: "relative" }}>
                <button onClick={() => setDownloadMenuOpen((o) => !o)} style={btnPrimary}>
                  Download ▾
                </button>
                {downloadMenuOpen && (
                  <>
                    <div onClick={() => setDownloadMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
                    <div style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      minWidth: 280,
                      background: "var(--bg)",
                      border: "1px solid var(--rule)",
                      zIndex: 40,
                      padding: 4,
                    }}>
                      <DownloadOption
                        title="Excel (.xlsx)"
                        sub={hasOriginalExcel ? "Appends columns to your original — formatting preserved" : "Adds columns to a fresh workbook"}
                        onClick={() => { setDownloadMenuOpen(false); onDownloadExcel(); }}
                      />
                      <DownloadOption
                        title="CSV"
                        sub="Plain CSV with all enriched columns"
                        onClick={() => { setDownloadMenuOpen(false); onDownload(); }}
                      />
                      <DownloadOption
                        title="Mihari-ready CSV"
                        sub={`${counts.matched} matched row${counts.matched === 1 ? "" : "s"} → entity_name, nzbn`}
                        onClick={() => { setDownloadMenuOpen(false); onDownloadMihari(); }}
                        disabled={counts.matched === 0}
                      />
                    </div>
                  </>
                )}
              </div>
              <button onClick={onStartOver} style={btnSecondary}>New file</button>
            </>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
          <span>{results.length - counts.pending - counts.processing} / {results.length} processed</span>
          <span>{pct}%</span>
        </div>
        <div style={{ height: 4, background: "var(--rule-soft)", position: "relative", overflow: "hidden" }}>
          <div style={{
            position: "absolute", inset: 0, width: `${pct}%`,
            background: !running ? (counts.error > 0 ? "var(--red)" : "var(--green)") : "var(--accent)",
            transition: "width 200ms ease",
          }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", border: "1px solid var(--rule)", marginBottom: 24 }}>
        <Stat label="All rows" value={results.length} color="var(--ink)" filter="all" active={filter} setFilter={setFilter} />
        <Stat label="Matched" value={counts.matched} color="var(--green)" filter="matched" active={filter} setFilter={setFilter} />
        <Stat label="Needs review" value={counts.review} color="var(--amber)" filter="needs_review" active={filter} setFilter={setFilter} />
        <Stat label="Not found" value={counts.notFound} color="var(--ink-dim)" filter="not_found" active={filter} setFilter={setFilter} />
        <Stat label="Errors" value={counts.error} color="var(--red)" filter="error" active={filter} setFilter={setFilter} />
        <Stat label="Rejected" value={counts.rejected} color="var(--ink-dim)" filter="rejected" active={filter} setFilter={setFilter} last />
      </div>

      {filter !== "all" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "10px 14px", background: "var(--panel)", border: "1px solid var(--rule-soft)" }}>
          <div style={{ fontSize: 13 }}>
            Showing <strong>{filtered.length}</strong> {statusLabel(filter as RowStatus).toLowerCase()} row{filtered.length === 1 ? "" : "s"}
            <button onClick={() => setFilter("all")} style={{ ...linkBtn, marginLeft: 12 }}>Clear filter</button>
          </div>
          {canRetry && filtered.length > 0 && (
            <button
              onClick={() => onRetry(filteredIndices)}
              disabled={running}
              style={{ ...btnSecondary, opacity: running ? 0.4 : 1 }}
            >
              Retry these {filtered.length} row{filtered.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}

      <div style={{ maxHeight: 540, overflow: "auto", border: "1px solid var(--rule-soft)" }}>
        <table style={{ width: "100%", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--bg)" }}>
            <tr style={{ background: "var(--panel)" }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Input name</th>
              <th style={thStyle}>Matched legal name</th>
              <th style={thStyle}>NZBN</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const enriched = r.enriched as undefined | {
                legal_name?: string;
                nzbn_id?: string;
                candidates?: { nzbn: string; entityName: string; score: number }[];
                error_message?: string;
              };
              const candidates = enriched?.candidates ?? [];
              const hasCandidates = candidates.length > 0
                && (r.status === "needs_review" || r.status === "not_found" || r.status === "rejected");
              const canReject = r.status === "matched" || r.status === "needs_review";
              const isOpen = expanded[r.index] ?? false;
              return (
                <Fragment key={r.index}>
                  <tr style={{ background: r.status === "processing" ? "var(--panel)" : "transparent" }}>
                    <td style={{ ...tdStyle, color: "var(--ink-faint)", width: 60 }}>{r.index + 1}</td>
                    <td style={tdStyle}>{inputNameFor(r.index)}</td>
                    <td style={tdStyle}>
                      {enriched?.legal_name ?? "—"}
                      {r.status === "error" && enriched?.error_message && (
                        <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4, fontStyle: "italic" }}>
                          {enriched.error_message}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--ink-dim)" }}>{enriched?.nzbn_id ?? "—"}</td>
                    <td style={{ ...tdStyle, color: statusColor(r.status) }}>{statusLabel(r.status)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                      {hasCandidates && (
                        <button
                          onClick={() => setExpanded((m) => ({ ...m, [r.index]: !isOpen }))}
                          style={linkBtn}
                        >
                          {isOpen ? "Hide candidates" : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`}
                        </button>
                      )}
                      {canReject && !running && (
                        <button
                          onClick={() => onReject(r.index)}
                          style={{ ...linkBtn, color: "var(--red)" }}
                          title="Clear this match. Candidates remain available so you can pick a different one."
                        >
                          Reject
                        </button>
                      )}
                      {(r.status === "error" || r.status === "rejected") && !running && (
                        <button onClick={() => onRetry([r.index])} style={linkBtn}>Retry</button>
                      )}
                    </td>
                  </tr>
                  {hasCandidates && isOpen && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0, background: "var(--panel)" }}>
                        <div style={{ padding: "12px 16px 16px 76px" }}>
                          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 8 }}>
                            Pick the candidate that matches your record. We&rsquo;ll re-fetch the
                            full entity details and update this row.
                          </div>
                          <table style={{ width: "100%", fontSize: 13 }}>
                            <tbody>
                              {candidates.map((c) => (
                                <tr key={c.nzbn}>
                                  <td style={{ padding: "6px 0", width: "55%" }}>{c.entityName}</td>
                                  <td style={{ padding: "6px 0", color: "var(--ink-dim)", fontVariantNumeric: "tabular-nums" }}>NZBN {c.nzbn}</td>
                                  <td style={{ padding: "6px 0", color: "var(--ink-dim)", fontVariantNumeric: "tabular-nums" }}>score {c.score.toFixed(2)}</td>
                                  <td style={{ padding: "6px 0", textAlign: "right" }}>
                                    <button
                                      onClick={async () => {
                                        await onPickCandidate(r.index, c.nzbn);
                                        setExpanded((m) => ({ ...m, [r.index]: false }));
                                      }}
                                      disabled={running}
                                      style={{ ...btnSecondary, padding: "6px 14px", fontSize: 12, opacity: running ? 0.4 : 1 }}
                                    >
                                      Use this one
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, color: "var(--ink-faint)", textAlign: "center", padding: "32px 0" }}>
                  No rows in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, color, last, filter, active, setFilter }: {
  label: string;
  value: number;
  color: string;
  last?: boolean;
  filter: Filter;
  active: Filter;
  setFilter: (f: Filter) => void;
}) {
  const isActive = active === filter;
  const clickable = value > 0 || filter === "all";
  return (
    <button
      onClick={() => clickable && setFilter(filter)}
      disabled={!clickable}
      style={{
        padding: "20px 24px",
        borderRight: last ? "none" : "1px solid var(--rule)",
        border: "none",
        borderTop: isActive ? `3px solid ${color}` : "3px solid transparent",
        background: isActive ? "var(--panel)" : "transparent",
        textAlign: "left",
        cursor: clickable ? "pointer" : "default",
        opacity: clickable ? 1 : 0.5,
        transition: "background 100ms ease",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 500, color, marginTop: 8, lineHeight: 1 }}>{value}</div>
    </button>
  );
}

function DownloadOption({ title, sub, onClick, disabled }: {
  title: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        borderBottom: "1px solid var(--rule-soft)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{sub}</div>
    </button>
  );
}

function statusColor(s: RowStatus): string {
  return s === "matched" ? "var(--green)"
    : s === "needs_review" ? "var(--amber)"
    : s === "error" ? "var(--red)"
    : "var(--ink-dim)";
}

function statusLabel(s: RowStatus): string {
  switch (s) {
    case "pending": return "Waiting";
    case "processing": return "Processing…";
    case "matched": return "Matched";
    case "needs_review": return "Needs review";
    case "not_found": return "Not found";
    case "error": return "Error";
    case "rejected": return "Rejected";
  }
}

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--accent)",
  fontSize: 13,
  cursor: "pointer",
  padding: "0 6px",
  textDecoration: "underline",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 22px",
  background: "var(--ink)",
  color: "var(--bg)",
  border: "1px solid var(--ink)",
  fontSize: 14,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "10px 22px",
  background: "transparent",
  color: "var(--ink)",
  border: "1px solid var(--rule)",
  fontSize: 14,
  cursor: "pointer",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--rule)",
  background: "white",
  color: "var(--ink)",
  outline: "none",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 12,
  color: "var(--ink-dim)",
  borderBottom: "1px solid var(--rule)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--rule-soft)",
};
