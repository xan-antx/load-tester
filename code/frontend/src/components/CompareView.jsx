import { thStyle, tdStyle, tableStyle } from "./Section";
import { parseStatsCsv } from "../utils/parseStatsCsv";
import { formatTime } from "../utils/formatTime";
import { failuresByKind } from "../utils/outcomes";
import OutcomeStrip from "./OutcomeStrip";
import { colors, font, space, type } from "../theme";

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
    return <span style={{ color: colors.textFaint, marginLeft: space.sm }}>—</span>;
  }
  const delta = ((value - base) / base) * 100;
  if (Math.abs(delta) < 0.05) {
    return <span style={{ color: colors.textFaint, marginLeft: space.sm }}>0%</span>;
  }
  const up = delta > 0;
  const color =
    goodWhenUp == null ? colors.textMuted : up === goodWhenUp ? colors.success : colors.danger;
  return (
    <span style={{ color, whiteSpace: "nowrap", fontSize: type.meta, marginLeft: space.sm }}>
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function runLabel(job, i) {
  return (
    <>
      <span style={{ color: colors.text }}>Run {i + 1}</span>
      <span style={{ marginLeft: space.sm }}>
        {job.users} users{Array.isArray(job.child_jobs) ? ", split" : ""}
      </span>
      <div style={{ fontSize: type.meta, color: colors.textFaint }}>{formatTime(job.created_at)}</div>
    </>
  );
}

function CaseCell({ cell }) {
  if (!cell) return <td style={{ ...tdStyle, color: colors.textFaint }}>—</td>;
  const lowSample = cell.low_sample;
  const passed = cell.rate === 0;
  return (
    <td
      style={tdStyle}
      title={lowSample ? "Low sample: fewer than 5 requests, not used to detect change" : undefined}
    >
      <span style={{ color: lowSample ? colors.textFaint : passed ? colors.success : colors.text }}>
        {cell.rate == null ? "—" : `${cell.rate.toFixed(0)}%`}
      </span>
      <span style={{ color: colors.textFaint, fontSize: type.meta, marginLeft: space.sm }}>
        n={cell.requests}
        {lowSample && ", low sample"}
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
    { label: "Requests", get: (t) => num(t, "Request Count"), fmt: (v) => Math.round(v), goodWhenUp: true },
    { label: "Failures", get: (t) => num(t, "Failure Count"), fmt: (v) => Math.round(v), goodWhenUp: false },
    { label: "Failure rate %", get: (t) => failureRate(t), fmt: (v) => v.toFixed(1), goodWhenUp: false },
    { label: "Avg response ms", get: (t) => num(t, "Average Response Time"), fmt: (v) => Math.round(v), goodWhenUp: false },
    { label: anyGroup ? "p95 response ms (≈ for split runs)" : "p95 response ms", get: (t) => num(t, "95%"), fmt: (v) => Math.round(v), goodWhenUp: false },
    { label: "Requests / s", get: (t) => num(t, "Requests/s"), fmt: (v) => v.toFixed(2), goodWhenUp: true },
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
          fontWeight: 600,
          fontSize: type.body,
          color: colors.text,
          paddingTop: space.lg,
        }}
      >
        {text}
      </td>
    </tr>
  );

  return (
    <div style={{ marginTop: space.xl }}>
      <h3 style={{ fontSize: type.body, fontWeight: 600, margin: `0 0 ${space.xs}px` }}>Run totals</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Metric</th>
              {jobs.map((j, i) => (
                <th key={j.job_id || j.group_id || i} style={thStyle}>
                  {runLabel(j, i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdStyle, color: colors.textMuted }}>Outcomes</td>
              {jobs.map((j, i) => (
                <td key={i} style={tdStyle}>
                  <OutcomeStrip
                    requests={num(totals[i], "Request Count")}
                    kindCounts={failuresByKind(j.failure_summary)}
                    failureTotal={num(totals[i], "Failure Count")}
                  />
                </td>
              ))}
            </tr>
            {metrics.map((m) => {
              const base = m.get(totals[0]);
              return (
                <tr key={m.label}>
                  <td style={{ ...tdStyle, color: colors.textMuted }}>{m.label}</td>
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
            <tr>
              <td style={{ ...tdStyle, color: colors.textMuted }}>Duration s</td>
              {jobs.map((j, i) => (
                <td key={i} style={tdStyle}>
                  {j.duration_seconds ?? "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: type.meta, color: colors.textMuted, marginTop: space.xs }}>
        ▲ / ▼ show the change against Run 1, the first run you ticked. Green is better, red is worse.
      </p>

      {rows.length > 0 && (
        <>
          <h3 style={{ fontSize: type.body, fontWeight: 600, marginTop: space.xl, marginBottom: space.xs }}>
            Failure rate per case
          </h3>
          <p style={{ fontSize: type.meta, color: colors.textMuted, marginTop: 0, maxWidth: "75ch" }}>
            Each cell is that case's failure rate in that run, with its request count (n). Faint
            cells had fewer than {caseComparison.min_requests} requests, so they are not used to decide
            whether a case changed. A case counts as changed with load when its failure rate differs
            by {caseComparison.threshold} percentage points or more between any two runs.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Case</th>
                  {jobs.map((j, i) => (
                    <th key={i} style={thStyle}>Run {i + 1}, {j.users} users</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectionHeader(`Changed with load (${changed.length})`)}
                {changed.length === 0 && (
                  <tr>
                    <td colSpan={jobs.length + 1} style={{ ...tdStyle, color: colors.textMuted }}>
                      No case changed by {caseComparison.threshold} or more points between these runs.
                    </td>
                  </tr>
                )}
                {changed.map((r) => (
                  <tr key={r.case} style={{ background: colors.accentSoft }}>
                    <td style={{ ...tdStyle, boxShadow: `inset 2px 0 0 ${colors.accent}` }}>
                      {r.case}
                      <span style={{ color: colors.accent, fontSize: type.meta, marginLeft: space.sm }}>
                        Δ {r.spread.toFixed(0)} pts
                      </span>
                    </td>
                    {r.cells.map((c, i) => <CaseCell key={i} cell={c} />)}
                  </tr>
                ))}
                {sectionHeader(`No significant change (${unchanged.length})`)}
                {unchanged.map((r) => (
                  <tr key={r.case}>
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
