import { useState } from "react";
import { btnStyle, preStyle, thStyle, tdStyle } from "./Section";
import { parseStatsCsv } from "../utils/parseStatsCsv";
import { colors, font, space, radius } from "../theme";

function rowStats(r) {
  const requests = Number(r["Request Count"]) || 0;
  const failures = Number(r["Failure Count"]) || 0;
  return { requests, failures, rate: requests > 0 ? (failures / requests) * 100 : 0 };
}

function rateColor(rate) {
  if (rate > 50) return colors.danger;
  if (rate > 10) return colors.warning;
  return colors.success;
}

function StatCard({ label, value, sub, valueColor }) {
  return (
    <div
      style={{
        flex: "1 1 120px",
        minWidth: 110,
        background: colors.surfaceRaised,
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.md,
        padding: `${space.md}px ${space.lg}px`,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.textMuted,
          marginBottom: space.xs,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontFamily: font.mono,
          color: valueColor || colors.text,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11.5, color: colors.textMuted, fontFamily: font.mono, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function FailBar({ rate }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 110 }}>
      <span style={{ minWidth: 42, textAlign: "right", color: rateColor(rate) }}>
        {rate.toFixed(0)}%
      </span>
      <div
        style={{
          flex: 1,
          height: 5,
          background: colors.track,
          borderRadius: radius.pill,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(rate, 100)}%`,
            height: "100%",
            background: colors.danger,
            borderRadius: radius.pill,
          }}
        />
      </div>
    </div>
  );
}

// The stats CSV only carries the case label, so the category is derived
// from the label prefixes used by the backend's edge-case generator.
const CATEGORY_ORDER = [
  "missing_field",
  "null_value",
  "type_mismatch",
  "boundary_value",
  "known_attack",
  "other",
];

export const CATEGORY_LABELS = {
  missing_field: "Missing Field",
  null_value: "Null Value",
  type_mismatch: "Type Mismatch",
  boundary_value: "Boundary Value",
  known_attack: "Known Attack",
  other: "Other",
};

function categoryOf(name) {
  if (!name) return "other";
  if (name.startsWith("missing_")) return "missing_field";
  if (name.startsWith("null_")) return "null_value";
  if (name.startsWith("wrong_type_")) return "type_mismatch";
  if (/^(empty_string_|very_long_string_|very_large_|negative_|zero_)/.test(name)) {
    return "boundary_value";
  }
  if (/^(sqli_|xss_)/.test(name)) return "known_attack";
  return "other";
}

const COLUMNS = [
  { key: "name", label: "Edge Case" },
  { key: "requests", label: "Requests" },
  { key: "failures", label: "Failures" },
  { key: "rate", label: "Fail %" },
  { key: "avg", label: "Avg (ms)" },
  { key: "min", label: "Min (ms)" },
  { key: "max", label: "Max (ms)" },
];

function rowValue(r, key) {
  const s = rowStats(r);
  switch (key) {
    case "name": return r.Name || "";
    case "requests": return s.requests;
    case "failures": return s.failures;
    case "rate": return s.rate;
    case "avg": return Number(r["Average Response Time"]) || 0;
    case "min": return Number(r["Min Response Time"]) || 0;
    case "max": return Number(r["Max Response Time"]) || 0;
    default: return 0;
  }
}

export default function JobResultSummary({ data, showRaw, onToggleRaw }) {
  const [sort, setSort] = useState({ key: "rate", dir: "desc" });
  const [view, setView] = useState("flat");
  const [collapsed, setCollapsed] = useState({});

  const rows = parseStatsCsv(data.aggregated_stats_csv || data.stats_csv);
  const nonAggregated = rows.filter((r) => r.Name && r.Name !== "Aggregated");
  const aggregated = rows.find((r) => r.Name === "Aggregated");

  const sorted = [...nonAggregated].sort((a, b) => {
    const av = rowValue(a, sort.key);
    const bv = rowValue(b, sort.key);
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sort.dir === "asc" ? cmp : -cmp;
  });

  function toggleSort(key) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" }
    );
  }

  const agg = aggregated ? rowStats(aggregated) : null;

  const groups = CATEGORY_ORDER.map((cat) => {
    const catRows = sorted.filter((r) => categoryOf(r.Name) === cat);
    const requests = catRows.reduce((sum, r) => sum + rowStats(r).requests, 0);
    const failures = catRows.reduce((sum, r) => sum + rowStats(r).failures, 0);
    return {
      cat,
      rows: catRows,
      requests,
      failures,
      rate: requests > 0 ? (failures / requests) * 100 : 0,
    };
  }).filter((g) => g.rows.length > 0);

  const viewToggleBtn = (mode, label) => (
    <button
      key={mode}
      onClick={() => setView(mode)}
      style={{
        padding: "4px 12px",
        fontSize: 12,
        fontWeight: 600,
        border: "none",
        cursor: "pointer",
        borderRadius: radius.sm,
        background: view === mode ? colors.accentSoft : "transparent",
        color: view === mode ? colors.accent : colors.textMuted,
      }}
    >
      {label}
    </button>
  );

  const resultRow = (r, i) => {
    const s = rowStats(r);
    return (
      <tr key={r.Name || i} style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}>
        <td style={tdStyle}>{r.Name}</td>
        <td style={tdStyle}>{s.requests}</td>
        <td style={{ ...tdStyle, color: s.failures > 0 ? colors.danger : colors.success, fontWeight: 600 }}>
          {s.failures}
        </td>
        <td style={tdStyle}>
          <FailBar rate={s.rate} />
        </td>
        <td style={tdStyle}>{Math.round(Number(r["Average Response Time"]))}</td>
        <td style={tdStyle}>{Math.round(Number(r["Min Response Time"]))}</td>
        <td style={tdStyle}>{Math.round(Number(r["Max Response Time"]))}</td>
      </tr>
    );
  };

  return (
    <div style={{ marginTop: space.md }}>
      {data.status === "failed" && data.error && (
        <div
          style={{
            background: colors.dangerSoft,
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            padding: space.md,
            borderRadius: radius.sm,
            fontSize: 13.5,
          }}
        >
          Error: {data.error}
        </div>
      )}

      {agg && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: space.sm, marginBottom: space.lg }}>
          <StatCard label="Total Requests" value={agg.requests} />
          <StatCard
            label="Failure Rate"
            value={`${agg.rate.toFixed(1)}%`}
            sub={`${agg.failures} / ${agg.requests}`}
            valueColor={rateColor(agg.rate)}
          />
          <StatCard
            label="Avg Response"
            value={`${Math.round(Number(aggregated["Average Response Time"]))} ms`}
          />
          <StatCard label="Requests/sec" value={Number(aggregated["Requests/s"]).toFixed(2)} />
          <StatCard
            label="Duration"
            value={data.duration_seconds != null ? `${data.duration_seconds} s` : "—"}
          />
        </div>
      )}

      {nonAggregated.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 2, marginBottom: space.xs }}>
          {viewToggleBtn("flat", "Flat")}
          {viewToggleBtn("grouped", "Grouped")}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${colors.border}`, textAlign: "left" }}>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    style={{ ...thStyle, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                    onClick={() => toggleSort(c.key)}
                    title={`Sort by ${c.label}`}
                  >
                    {c.label}
                    <span style={{ color: colors.accent, marginLeft: 4, fontSize: 10 }}>
                      {sort.key === c.key ? (sort.dir === "desc" ? "▾" : "▴") : ""}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view === "flat" && sorted.map(resultRow)}
              {view === "grouped" &&
                groups.map((g) => {
                  const isOpen = !collapsed[g.cat];
                  return [
                    <tr
                      key={`hdr-${g.cat}`}
                      onClick={() => setCollapsed((prev) => ({ ...prev, [g.cat]: !prev[g.cat] }))}
                      style={{
                        background: colors.surfaceRaised,
                        borderBottom: `1px solid ${colors.border}`,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      title={isOpen ? "Collapse" : "Expand"}
                    >
                      <td style={{ ...tdStyle, fontFamily: font.sans, fontWeight: 600, whiteSpace: "nowrap" }}>
                        <span style={{ color: colors.accent, marginRight: 6, fontSize: 10 }}>
                          {isOpen ? "▾" : "▸"}
                        </span>
                        {CATEGORY_LABELS[g.cat]}
                        <span style={{ color: colors.textMuted, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                          ({g.rows.length})
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{g.requests}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: g.failures > 0 ? colors.danger : colors.success }}>
                        {g.failures}
                      </td>
                      <td style={tdStyle}>
                        <FailBar rate={g.rate} />
                      </td>
                      <td style={tdStyle} colSpan={3} />
                    </tr>,
                    ...(isOpen ? g.rows.map(resultRow) : []),
                  ];
                })}
              {aggregated && agg && (
                <tr style={{ fontWeight: 700, borderTop: `2px solid ${colors.border}` }}>
                  <td style={tdStyle}>Total</td>
                  <td style={tdStyle}>{agg.requests}</td>
                  <td style={{ ...tdStyle, color: agg.failures > 0 ? colors.danger : colors.success }}>
                    {agg.failures}
                  </td>
                  <td style={tdStyle}>
                    <FailBar rate={agg.rate} />
                  </td>
                  <td style={tdStyle}>{Math.round(Number(aggregated["Average Response Time"]))}</td>
                  <td style={tdStyle}>{Math.round(Number(aggregated["Min Response Time"]))}</td>
                  <td style={tdStyle}>{Math.round(Number(aggregated["Max Response Time"]))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={onToggleRaw}
        style={{
          ...btnStyle,
          background: "transparent",
          color: colors.accent,
          padding: "4px 0",
          marginTop: space.sm,
        }}
      >
        {showRaw ? "Hide raw response" : "Show raw response"}
      </button>

      {showRaw && <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
