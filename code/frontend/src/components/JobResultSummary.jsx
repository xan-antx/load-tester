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
              {sorted.map((r, i) => {
                const s = rowStats(r);
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}>
                    <td style={tdStyle}>{r.Name}</td>
                    <td style={tdStyle}>{s.requests}</td>
                    <td
                      style={{
                        ...tdStyle,
                        color: s.failures > 0 ? colors.danger : colors.success,
                        fontWeight: 600,
                      }}
                    >
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
