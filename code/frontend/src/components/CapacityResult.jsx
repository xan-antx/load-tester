import { useState } from "react";
import { subPanelStyle, tableStyle, thStyle, tdStyle } from "./Section";
import { colors, font, radius, space, type } from "../theme";

// The result of a "Find capacity" run (analysis/capacity.py): a headline,
// two small charts that share the step axis (p95 per step, error rates per
// step, each with its SLO line and the breaking point marked), and the steps
// table, which doubles as the charts' accessible table view.
//
// Two charts instead of one with two y-axes: milliseconds and percentages
// are different scales, and a dual-axis chart invites false comparisons.

const W = 960;
const H = 170;
const PAD = { left: 52, right: 16, top: 14, bottom: 26 };

const fmt = (v, d = 0) => (v == null ? "—" : Number(v).toFixed(d));

function niceMax(value) {
  if (!value || value <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= value) return m * p;
  return 10 * p;
}

// One single-axis step chart. series: [{ key, label, color }].
function StepChart({ title, unit, steps, series, sloLines, breakingIndex, hover, onHover }) {
  const values = steps.flatMap((s) => series.map((x) => s[x.key])).filter((v) => v != null);
  const top = niceMax(Math.max(...values, ...sloLines.map((l) => l.value), 0) * 1.1);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (steps.length === 1 ? plotW / 2 : (i / (steps.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];
  const colW = steps.length > 1 ? plotW / (steps.length - 1) : plotW;

  return (
    <figure style={{ margin: `${space.sm}px 0 0` }}>
      <figcaption style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.md, fontSize: type.meta, color: colors.textMuted }}>
        <span style={{ fontWeight: 600, color: colors.text, fontSize: type.body }}>{title}</span>
        {series.length > 1 && series.map((s) => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: space.xs }}>
            <span style={{ width: 12, height: 2, background: s.color }} />
            {s.label}
          </span>
        ))}
        {sloLines.map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: space.xs }}>
            <span style={{ width: 12, borderTop: `2px dashed ${colors.textMuted}` }} />
            {l.label}
          </span>
        ))}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title} for each step; the steps table below lists the same values`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => onHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={colors.grid} strokeWidth="1" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fill={colors.textMuted} fontSize="11" fontFamily={font.mono}>
              {Number(t.toFixed(1))}{unit === "%" ? "%" : ""}
            </text>
          </g>
        ))}
        {sloLines.map((l) => (
          <line key={l.label} x1={PAD.left} x2={W - PAD.right} y1={y(l.value)} y2={y(l.value)}
            stroke={colors.textMuted} strokeWidth="1.5" strokeDasharray="6 4" />
        ))}
        {breakingIndex != null && (
          <g>
            <line x1={x(breakingIndex)} x2={x(breakingIndex)} y1={PAD.top} y2={PAD.top + plotH}
              stroke={colors.danger} strokeWidth="1.5" strokeDasharray="3 3" />
            {/* Label on the inner side, so it is never clipped at the right edge. */}
            <text
              x={x(breakingIndex) > W / 2 ? x(breakingIndex) - 6 : x(breakingIndex) + 6}
              y={PAD.top + 10}
              textAnchor={x(breakingIndex) > W / 2 ? "end" : "start"}
              fill={colors.text}
              fontSize="11"
            >
              breaking point
            </text>
          </g>
        )}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={colors.textMuted} strokeWidth="1" />
        )}
        {series.map((s) => {
          const pts = steps.map((st, i) => (st[s.key] == null ? null : [x(i), y(st[s.key])])).filter(Boolean);
          return (
            <g key={s.key}>
              <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth="2"
                strokeLinejoin="round" />
              {steps.map((st, i) => st[s.key] == null ? null : (
                <circle key={i} cx={x(i)} cy={y(st[s.key])} r={hover === i ? 5 : 4}
                  fill={st.complete ? s.color : colors.surface} stroke={st.complete ? colors.surface : s.color}
                  strokeWidth="2" />
              ))}
            </g>
          );
        })}
        {steps.map((st, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fill={colors.textMuted} fontSize="11" fontFamily={font.mono}>
            {st.planned_users}
          </text>
        ))}
        {/* Hit targets wider than the marks: one column per step. */}
        {steps.map((st, i) => (
          <rect key={i} x={x(i) - colW / 2} y={PAD.top} width={colW} height={plotH} fill="transparent"
            onMouseEnter={() => onHover(i)} />
        ))}
      </svg>
    </figure>
  );
}

export default function CapacityResult({ capacity, plan, slo }) {
  const [hover, setHover] = useState(null);
  if (!capacity) return null;
  const steps = capacity.steps || [];
  const breakingIndex = steps.findIndex((s) => s.planned_users === capacity.breaking_point_users && s.complete);
  const h = hover != null ? steps[hover] : null;
  const found = capacity.breaking_point_users != null;
  const tone = capacity.max_sustainable_users != null ? colors.accent : colors.danger;

  const errorSeries = [
    { key: "server_error_rate_pct", label: "Server errors (5xx + no answer)", color: colors.series2 },
    { key: "unexpected_outcome_rate_pct", label: "Unexpected answers", color: colors.series1 },
  ].filter((s) => steps.some((st) => st[s.key] != null));
  const errorSlo = [
    slo?.max_server_error_rate_pct != null && { label: `SLO server errors ${slo.max_server_error_rate_pct}%`, value: slo.max_server_error_rate_pct },
    slo?.max_unexpected_outcome_rate_pct != null && { label: `SLO unexpected ${slo.max_unexpected_outcome_rate_pct}%`, value: slo.max_unexpected_outcome_rate_pct },
  ].filter(Boolean);

  return (
    <section aria-label="Capacity result" style={{ marginBottom: space.lg }}>
      <div
        style={{
          border: `1px solid ${tone}`,
          borderLeft: `4px solid ${tone}`,
          background: colors.accentSoft,
          borderRadius: radius.md,
          padding: `${space.md}px ${space.lg}px`,
        }}
      >
        <div role="status" style={{ fontSize: type.title, fontWeight: 600, color: colors.text }}>{capacity.headline}</div>
        <div style={{ fontSize: type.body, color: colors.textMuted, marginTop: space.xs }}>
          {found
            ? <>Breaking point: <strong style={{ color: colors.text }}>{capacity.breaking_point_users} users</strong> ({capacity.breaking_reason}).</>
            : `Tested up to ${capacity.tested_up_to_users ?? "—"} users.`}
          {capacity.stopped_early && found && " Stopped after the first failing step."}
          {" "}Steps of {plan?.step_users} users every {plan?.step_duration_seconds} s, judged on {capacity.criteria}.
          {" "}Capacity runs always run as one Locust process (never split into parallel processes).
        </div>
      </div>

      {steps.length > 0 && (
        <div style={{ ...subPanelStyle, padding: space.md, marginTop: space.sm }}>
          <div aria-live="polite" style={{ fontFamily: font.mono, fontSize: type.meta, color: colors.textMuted, minHeight: 18 }}>
            {h
              ? `${h.planned_users} users · ${fmt(h.rps, 1)} req/s · p95 ${fmt(h.p95_ms)} ms · server errors ${fmt(h.server_error_rate_pct, 1)}% · 429 ${fmt(h.rate_limited_pct, 1)}% · ${h.complete ? h.verdict || "not judged" : "partial step"}`
              : "Hover a chart to read one step's values"}
          </div>
          <StepChart
            title="p95 response time per step (ms)"
            unit="ms"
            steps={steps}
            series={[{ key: "p95_ms", label: "p95", color: colors.series1 }]}
            sloLines={slo?.p95_ms != null ? [{ label: `SLO p95 ${slo.p95_ms} ms`, value: slo.p95_ms }] : []}
            breakingIndex={breakingIndex >= 0 ? breakingIndex : null}
            hover={hover}
            onHover={setHover}
          />
          {errorSeries.length > 0 && (
            <StepChart
              title="Errors per step (%)"
              unit="%"
              steps={steps}
              series={errorSeries}
              sloLines={errorSlo}
              breakingIndex={breakingIndex >= 0 ? breakingIndex : null}
              hover={hover}
              onHover={setHover}
            />
          )}
          <p style={{ margin: `${space.xs}px 0 0`, fontSize: type.meta, color: colors.textMuted }}>
            Users per step on the horizontal axis. Hollow points are partial steps (the run ended during them); they
            are not used for the verdict.
          </p>
        </div>
      )}

      {steps.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: space.sm }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {["Step", "Users", "Req / s", "p95 ms", "Avg ms", "Server errors", "Unexpected", "429", "Verdict"].map((hd) => (
                  <th key={hd} style={thStyle}>{hd}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => {
                const mark = !s.complete ? "partial" : s.verdict === "PASS" ? "✓ PASS" : s.verdict === "FAIL" ? "✗ FAIL" : "—";
                const color = !s.complete ? colors.textMuted : s.verdict === "PASS" ? colors.success : s.verdict === "FAIL" ? colors.danger : colors.textMuted;
                return (
                  <tr key={s.step} style={s.planned_users === capacity.breaking_point_users ? { background: colors.dangerSoft } : undefined}>
                    <td style={tdStyle}>{s.step + 1}</td>
                    <td style={tdStyle}>{s.planned_users}</td>
                    <td style={tdStyle}>{fmt(s.rps, 1)}</td>
                    <td style={tdStyle}>{fmt(s.p95_ms)}</td>
                    <td style={tdStyle}>{fmt(s.avg_ms)}</td>
                    <td style={tdStyle}>{s.server_error_rate_pct == null ? "—" : `${fmt(s.server_error_rate_pct, 1)}%`}</td>
                    <td style={tdStyle}>{s.unexpected_outcome_rate_pct == null ? "—" : `${fmt(s.unexpected_outcome_rate_pct, 1)}%`}</td>
                    <td style={tdStyle}>{s.rate_limited_pct == null ? "—" : `${fmt(s.rate_limited_pct, 1)}%`}</td>
                    <td style={{ ...tdStyle, color }} title={s.failed_checks?.join("; ") || undefined}>{mark}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
