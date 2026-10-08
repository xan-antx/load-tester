import { useState } from "react";
import { parseStatsCsv } from "../utils/parseStatsCsv";
import { thStyle, tdStyle, tableStyle, subPanelStyle } from "./Section";
import { colors, font, space, type } from "../theme";

// Drawing area inside each SVG (viewBox units; the SVG scales to its box).
// Roughly the panel's real width in the 1080px layout, so text stays ~10px.
const W = 960;
const PAD = { left: 44, right: 12, top: 8, bottom: 8 };
const X_AXIS_HEIGHT = 30;

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Locust's per-second history -> [{t, users, rps, fps, avg, p95}], t in
// seconds since the first row.
function toPoints(historyCsv) {
  const rows = parseStatsCsv(historyCsv).filter((r) => r.Name === "Aggregated");
  if (rows.length === 0) return [];
  const t0 = Number(rows[0].Timestamp);
  return rows.map((r) => ({
    t: Number(r.Timestamp) - t0,
    users: toNumber(r["User Count"]),
    rps: toNumber(r["Requests/s"]),
    fps: toNumber(r["Failures/s"]),
    avg: toNumber(r["Total Average Response Time"]),
    p95: toNumber(r["95%"]),
  }));
}

// Rounds a maximum up to a tidy axis top (1, 2, 5 x 10^n).
function niceMax(value) {
  if (!value || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value);
  return step * power;
}

function LineChart({ title, points, series, xMax, hoverIndex, onHover, showXAxis }) {
  const plotHeight = 90;
  const height = PAD.top + plotHeight + PAD.bottom + (showXAxis ? X_AXIS_HEIGHT : 0);
  const yMax = niceMax(Math.max(0, ...points.flatMap((p) => series.map((s) => p[s.key] ?? 0))));
  const x = (t) => PAD.left + (xMax ? t / xMax : 0) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - v / yMax) * plotHeight;

  // A missing value (Locust's "N/A") breaks the line instead of dropping to 0.
  const pathFor = (key) => {
    let d = "";
    let pen = "M";
    for (const p of points) {
      if (p[key] == null) {
        pen = "M";
        continue;
      }
      d += `${pen}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)} `;
      pen = "L";
    }
    return d;
  };

  const xTickStep = xMax > 60 ? 15 : xMax > 20 ? 5 : 2;
  const xTicks = [];
  for (let t = 0; t <= xMax; t += xTickStep) xTicks.push(t);

  function handleMove(e) {
    const box = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - box.left) / box.width) * W;
    const t = ((svgX - PAD.left) / (W - PAD.left - PAD.right)) * xMax;
    let nearest = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.t - t) < Math.abs(points[nearest].t - t)) nearest = i;
    });
    onHover(nearest);
  }

  const hovered = hoverIndex != null ? points[hoverIndex] : null;

  return (
    <div style={{ marginBottom: space.xs }}>
      <div style={{ display: "flex", alignItems: "center", gap: space.md, fontSize: type.meta, color: colors.textMuted }}>
        <span style={{ color: colors.text, fontWeight: 500 }}>{title}</span>
        {series.length > 1 &&
          series.map((s) => (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: space.sm }}>
              <span style={{ width: 14, height: 2, background: s.color, display: "inline-block" }} />
              {s.label}
            </span>
          ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMove}
        onMouseLeave={() => onHover(null)}
        role="img"
        aria-label={`${title} over time`}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(yMax * f)} y2={y(yMax * f)} stroke={colors.grid} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(yMax * f) + 4} textAnchor="end" fontSize={type.meta} fill={colors.textMuted} fontFamily={font.mono}>
              {Math.round(yMax * f)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hovered && (
          <g>
            <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={PAD.top + plotHeight} stroke={colors.textMuted} strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s) =>
              hovered[s.key] == null ? null : (
                <circle key={s.key} cx={x(hovered.t)} cy={y(hovered[s.key])} r={4} fill={s.color} stroke={colors.surface} strokeWidth={2} />
              )
            )}
          </g>
        )}
        {showXAxis && (
          <g>
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={PAD.top + plotHeight + 16} textAnchor="middle" fontSize={type.meta} fill={colors.textMuted} fontFamily={font.mono}>
                {t}s
              </text>
            ))}
            <text x={W / 2} y={height - 2} textAnchor="middle" fontSize={type.meta} fill={colors.textMuted}>
              seconds since the test started
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function Timeline({ historyCsv }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const points = toPoints(historyCsv);
  if (points.length < 2) return null;

  const xMax = points[points.length - 1].t || 1;
  const shared = { points, xMax, hoverIndex, onHover: setHoverIndex };
  const h = hoverIndex != null ? points[hoverIndex] : null;
  const fmt = (v, digits = 0) => (v == null ? "—" : v.toFixed(digits));

  return (
    <div style={{ ...subPanelStyle, marginTop: space.md, padding: space.md }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: space.sm, marginBottom: space.sm }}>
        <h3 style={{ margin: 0, fontSize: type.body, fontWeight: 600 }}>Timeline</h3>
        <span
          aria-live="polite"
          style={{ display: "flex", gap: space.md, fontSize: type.meta, color: colors.textMuted, fontFamily: font.mono }}
        >
          {h ? (
            <>
              <span style={{ color: colors.text }}>{h.t}s</span>
              <span>{fmt(h.users)} users</span>
              <span>{fmt(h.rps, 1)} req/s</span>
              <span>{fmt(h.fps, 1)} fail/s</span>
              <span>avg {fmt(h.avg)} ms</span>
              <span>p95 {fmt(h.p95)} ms</span>
            </>
          ) : (
            "Hover a chart to read the values at that second"
          )}
        </span>
      </div>
      <LineChart title="Active users" series={[{ key: "users", label: "Users", color: colors.series1 }]} {...shared} />
      <LineChart
        title="Throughput (per second)"
        series={[
          { key: "rps", label: "Requests/s", color: colors.series1 },
          { key: "fps", label: "Failures/s", color: colors.series2 },
        ]}
        {...shared}
      />
      <LineChart
        title="Response time (ms)"
        series={[
          { key: "avg", label: "Average so far", color: colors.series1 },
          { key: "p95", label: "p95 (last few seconds)", color: colors.series2 },
        ]}
        showXAxis
        {...shared}
      />
      <p style={{ fontSize: type.meta, color: colors.textMuted, margin: `${space.xs}px 0 0`, maxWidth: "80ch" }}>
        Locust reports the average as a running average since the start, and p95 over a short
        rolling window, so p95 reacts faster when the server starts to slow down.
      </p>
      <button onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} className="btn-link">
        {showTable ? "Hide data table" : "Show data table"}
      </button>
      {showTable && (
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          <table style={{ ...tableStyle, fontSize: type.meta }}>
            <thead>
              <tr>
                {["Second", "Users", "Req/s", "Fail/s", "Avg ms", "p95 ms"].map((hdr) => (
                  <th key={hdr} style={thStyle}>{hdr}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.t}>
                  <td style={tdStyle}>{p.t}</td>
                  <td style={tdStyle}>{fmt(p.users)}</td>
                  <td style={tdStyle}>{fmt(p.rps, 1)}</td>
                  <td style={tdStyle}>{fmt(p.fps, 1)}</td>
                  <td style={tdStyle}>{fmt(p.avg)}</td>
                  <td style={tdStyle}>{fmt(p.p95)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
