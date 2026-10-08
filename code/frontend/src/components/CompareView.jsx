import { thStyle, tdStyle } from "./Section";
import { parseStatsCsv } from "../utils/parseStatsCsv";
import { formatTime } from "../utils/formatTime";
import { colors, font, space } from "../theme";

function num(row, key) {
  if (!row || row[key] == null) return null;
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : null;
}

function failureRate(row) {
  const req = num(row, "Request Count");
  const fail = num(row, "Failure Count");
  if (req == null || fail == null || req === 0) return null;
  return (fail / req) * 100;
}

// goodWhenUp: true = an increase is an improvement (green), false = an
// increase is a regression (red), null = neutral config value (no verdict).
function Delta({ base, value, goodWhenUp }) {
  if (base == null || value == null || base === 0) {
    return <span style={{ color: colors.textMuted }}> —</span>;
  }
  const delta = ((value - base) / base) * 100;
  if (Math.abs(delta) < 0.05) {
    return <span style={{ color: colors.textMuted }}> 0%</span>;
  }
  const up = delta > 0;
  const color =
    goodWhenUp == null ? colors.textMuted : up === goodWhenUp ? colors.success : colors.danger;
  return (
    <span style={{ color, fontWeight: 600, whiteSpace: "nowrap", fontSize: 11.5, marginLeft: 6 }}>
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function runLabel(job, i) {
  return (
    <>
      Run {i + 1} ({job.users}u{Array.isArray(job.child_jobs) ? ", split" : ""})
      <div style={{ fontWeight: 400, fontSize: 11, color: colors.textMuted }}>
        {formatTime(job.created_at)}
      </div>
    </>
  );
}

function rateCellColor(rate) {
  if (rate == null) return colors.textMuted;
  if (rate > 50) return colors.danger;
  if (rate > 10) return colors.warning;
  return colors.success;
}

function CaseCell({ cell }) {
  if (!cell) return <td style={{ ...tdStyle, color: colors.textMuted }}>—</td>;
  return (
    <td
      style={{ ...tdStyle, opacity: cell.low_sample ? 0.45 : 1 }}
      title={cell.low_sample ? "Low sample: fewer than 5 requests, not used to detect change" : undefined}
    >
      <span style={{ color: rateCellColor(cell.rate), fontWeight: 600 }}>
        {cell.rate == null ? "—" : `${cell.rate.toFixed(0)}%`}
      </span>
      <span style={{ color: colors.textMuted, fontSize: 11, marginLeft: 5 }}>
        n={cell.requests}
        {cell.low_sample && " · low sample"}
      </span>
    </td>
  );
}

export default function CompareView({ jobs, caseComparison }) {
  const totals = jobs.map((j) =>
    parseStatsCsv(j.aggregated_stats_csv || j.stats_csv).find((r) => r.Name === "Aggregated")
  );
  const anyGroup = jobs.some((j) => Array.isArray(j.child_jobs));

  const metrics = [
    { label: "Total Requests", get: (t) => num(t, "Request Count"), fmt: (v) => Math.round(v), goodWhenUp: true },
    { label: "Total Failures", get: (t) => num(t, "Failure Count"), fmt: (v) => Math.round(v), goodWhenUp: false },
    { label: "Failure Rate (%)", get: (t) => failureRate(t), fmt: (v) => v.toFixed(1), goodWhenUp: false },
    { label: "Avg Response (ms)", get: (t) => num(t, "Average Response Time"), fmt: (v) => Math.round(v), goodWhenUp: false },
    { label: anyGroup ? "p95 Response (ms, ≈ for split)" : "p95 Response (ms)", get: (t) => num(t, "95%"), fmt: (v) => Math.round(v), goodWhenUp: false },
    { label: "Requests/sec", get: (t) => num(t, "Requests/s"), fmt: (v) => v.toFixed(2), goodWhenUp: true },
  ];

  const rows = caseComparison?.rows || [];
  const changed = rows.filter((r) => r.changed);
  const unchanged = rows.filter((r) => !r.changed);

  const sectionHeader = (text) => (
    <tr>
      <td
        colSpan={jobs.length + 1}
        style={{
          ...tdStyle,
          fontFamily: font.sans,
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: colors.textMuted,
          paddingTop: space.md,
        }}
      >
        {text}
      </td>
    </tr>
  );

  return (
    <div style={{ marginTop: space.lg }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${colors.border}`, textAlign: "left" }}>
              <th style={thStyle}>Metric</th>
              {jobs.map((j, i) => (
                <th key={j.job_id || j.group_id || i} style={thStyle}>
                  {runLabel(j, i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const base = m.get(totals[0]);
              return (
                <tr key={m.label} style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}>
                  <td style={tdStyle}>{m.label}</td>
                  {totals.map((t, i) => {
                    const v = m.get(t);
                    return (
                      <td key={i} style={tdStyle}>
                        {v != null ? m.fmt(v) : "—"}
                        {i > 0 && <Delta base={base} value={v} goodWhenUp={m.goodWhenUp} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}>
              <td style={tdStyle}>Duration (s)</td>
              {jobs.map((j, i) => (
                <td key={i} style={{ ...tdStyle, color: colors.textMuted }}>
                  {j.duration_seconds ?? "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11.5, color: colors.textMuted, marginTop: space.xs }}>
        ▲/▼ = change vs Run 1 (the first run you selected). Green is better, red is worse.
      </p>

      {rows.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, marginTop: space.xl, marginBottom: space.xs }}>
            Per-case failure rate
          </h3>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 0 }}>
            Each cell is the failure % for that case in that run, with its request count (n).
            Faded cells had fewer than {caseComparison.min_requests} requests ("low sample") and are
            not used to decide whether a case changed. A case is listed under "Changed with load" when
            its failure rate differs by {caseComparison.threshold} percentage points or more between
            any two runs.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${colors.border}`, textAlign: "left" }}>
                  <th style={thStyle}>Case</th>
                  {jobs.map((j, i) => (
                    <th key={i} style={thStyle}>Run {i + 1} ({j.users}u)</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectionHeader(`Changed with load (${changed.length})`)}
                {changed.length === 0 && (
                  <tr>
                    <td colSpan={jobs.length + 1} style={{ ...tdStyle, color: colors.textMuted }}>
                      No case changed by {caseComparison.threshold}+ points.
                    </td>
                  </tr>
                )}
                {changed.map((r) => (
                  <tr
                    key={r.case}
                    style={{
                      background: colors.warningSoft,
                      borderBottom: `1px solid ${colors.borderSubtle}`,
                      borderLeft: `3px solid ${colors.warning}`,
                    }}
                  >
                    <td style={tdStyle}>
                      {r.case}
                      <span style={{ color: colors.warning, fontSize: 11, marginLeft: 6 }}>
                        Δ{r.spread.toFixed(0)} pts
                      </span>
                    </td>
                    {r.cells.map((c, i) => <CaseCell key={i} cell={c} />)}
                  </tr>
                ))}
                {sectionHeader(`No significant change (${unchanged.length})`)}
                {unchanged.map((r) => (
                  <tr key={r.case} style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}>
                    <td style={tdStyle}>{r.case}</td>
                    {r.cells.map((c, i) => <CaseCell key={i} cell={c} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
