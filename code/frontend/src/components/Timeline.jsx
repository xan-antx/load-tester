import { useState } from "react";
import { parseStatsCsv } from "../utils/parseStatsCsv";
import { colors, font, type } from "../theme";

// Drawing area inside each SVG (viewBox units; the SVG scales to its box).
const W = 960;
const PAD = { left: 52, right: 16, top: 14, bottom: 8 };
const X_AXIS_HEIGHT = 34;
const PLOT_H = 120;

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

// A tidy axis top just above the data (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^n),
// so a 160 ms peak gets a 200 axis, not 500.
function niceMax(value) {
  if (!value || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * power >= value * 1.05);
  return step * power;
}

const tickLabel = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : Number.isInteger(v) ? String(v) : v.toFixed(1));

function LineChart({ title, unit, points, series, thresholds = [], rampEnd, xMax, hoverIndex, onHover, showXAxis }) {
  const height = PAD.top + PLOT_H + PAD.bottom + (showXAxis ? X_AXIS_HEIGHT : 0);
  const dataMax = Math.max(0, ...points.flatMap((p) => series.map((s) => p[s.key] ?? 0)));
  const yMax = niceMax(Math.max(dataMax, ...thresholds.map((t) => t.value)));
  const x = (t) => PAD.left + (xMax ? t / xMax : 0) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - v / yMax) * PLOT_H;

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

  const xTickStep = xMax > 120 ? 30 : xMax > 60 ? 15 : xMax > 20 ? 5 : 2;
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
    <figure className="chart">
      <figcaption className="chart-legend">
        <span className="chart-title">{title}</span>
        {series.map((s) => (
          <span key={s.key} className="legend-item">
            <span className="legend-line" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {thresholds.map((t) => (
          <span key={t.label} className="legend-item">
            <span className="legend-line is-dashed" style={{ borderColor: t.color }} />
            {t.label}
          </span>
        ))}
        {rampEnd > 0 && (
          <span className="legend-item">
            <span className="legend-band" />
            ramp-up
          </span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMove}
        onMouseLeave={() => onHover(null)}
        role="img"
        aria-label={`${title} over time, up to ${tickLabel(dataMax)} ${unit}`}
      >
        {rampEnd > 0 && (
          <rect x={x(0)} y={PAD.top} width={Math.max(x(rampEnd) - x(0), 0)} height={PLOT_H} fill={colors.surfaceRaised} />
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(yMax * f)} y2={y(yMax * f)} stroke={colors.grid} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(yMax * f) + 4} textAnchor="end" fontSize={type.meta} fill={colors.textMuted} fontFamily={font.mono}>
              {tickLabel(yMax * f)}
            </text>
          </g>
        ))}
        {thresholds.map((t) => (
          <line
            key={t.label}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t.value)}
            y2={y(t.value)}
            stroke={t.color}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        ))}
        {series.map((s) => (
          <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hovered && (
          <g>
            <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={PAD.top + PLOT_H} stroke={colors.textMuted} strokeWidth={1} strokeDasharray="3 3" />
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
              <text key={t} x={x(t)} y={PAD.top + PLOT_H + 18} textAnchor="middle" fontSize={type.meta} fill={colors.textMuted} fontFamily={font.mono}>
                {t}s
              </text>
            ))}
            <text x={W / 2} y={height - 2} textAnchor="middle" fontSize={type.meta} fill={colors.textMuted} fontFamily={font.sans}>
              seconds since the test started
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}

// approximate: merged history of a split run, so its p95 line is approximate.
// slo: the run's thresholds; p95_ms and avg_ms are drawn as dashed lines.
export default function Timeline({ historyCsv, approximate = false, slo = null, unexpectedLabel = "Unexpected/s" }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const points = toPoints(historyCsv);
  // Fewer than 5 seconds of history says nothing a chart can show.
  if (points.length < 5) return null;

  const xMax = points[points.length - 1].t || 1;
  const peakUsers = Math.max(0, ...points.map((p) => p.users ?? 0));
  const rampPoint = points.find((p) => (p.users ?? 0) >= peakUsers);
  const rampEnd = rampPoint && rampPoint.t > 0 && rampPoint.t < xMax ? rampPoint.t : 0;
  const shared = { points, xMax, hoverIndex, onHover: setHoverIndex, rampEnd };
  const h = hoverIndex != null ? points[hoverIndex] : null;
  const fmt = (v, digits = 0) => (v == null ? "—" : v.toFixed(digits));
  const thresholds = [];
  if (slo?.p95_ms != null) thresholds.push({ value: slo.p95_ms, label: `p95 target ${slo.p95_ms} ms`, color: colors.text });
  if (slo?.avg_ms != null) thresholds.push({ value: slo.avg_ms, label: `average target ${slo.avg_ms} ms`, color: colors.textMuted });

  return (
    <section className="block" aria-labelledby="timeline-title">
      <div className="block-head">
        <h3 id="timeline-title">Over time</h3>
        <span aria-live="polite" className="chart-readout">
          {h ? (
            <>
              <span>{h.t}s</span>
              <span>{fmt(h.users)} users</span>
              <span>{fmt(h.rps, 1)} req/s</span>
              <span>{fmt(h.fps, 1)} unexpected/s</span>
              <span>avg {fmt(h.avg)} ms</span>
              <span>{approximate ? "≈" : ""}p95 {fmt(h.p95)} ms</span>
            </>
          ) : (
            <span className="hint">Point at a chart to read the values at that second.</span>
          )}
        </span>
      </div>
      <LineChart
        title="Requests per second"
        unit="requests per second"
        series={[
          { key: "rps", label: "All requests", color: colors.series1 },
          { key: "fps", label: unexpectedLabel, color: colors.series2 },
        ]}
        {...shared}
      />
      <LineChart
        title="Response time (ms)"
        unit="ms"
        series={[
          { key: "avg", label: "Average so far", color: colors.series1 },
          { key: "p95", label: approximate ? "≈ p95 (merged)" : "p95, last few seconds", color: colors.series2 },
        ]}
        thresholds={thresholds}
        showXAxis
        {...shared}
      />
      <div className="block-foot">
        <button type="button" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} className="btn-link">
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      </div>
      {showTable && (
        <div className="table-scroll is-capped">
          <table className="data-table">
            <thead>
              <tr>
                {["Second", "Users", "Req/s", "Unexpected/s", "Avg ms", "p95 ms"].map((hdr) => (
                  <th key={hdr} className="num">{hdr}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.t}>
                  <td className="num">{p.t}</td>
                  <td className="num">{fmt(p.users)}</td>
                  <td className="num">{fmt(p.rps, 1)}</td>
                  <td className="num">{fmt(p.fps, 1)}</td>
                  <td className="num">{fmt(p.avg)}</td>
                  <td className="num">{fmt(p.p95)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
