import { thStyle, tdStyle, tableStyle } from "./Section";
import { formatTime } from "../utils/formatTime";
import { runReport, formatPct } from "../utils/runReport";
import OutcomeStrip from "./OutcomeStrip";
import { VerdictChip } from "./SloVerdict";
import { colors, font, space, type } from "../theme";

function num(row, key) {
  if (!row || row[key] == null) return null;
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : null;
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

// For small counts (bugs, untested cases) the absolute change says more.
function AbsDelta({ base, value }) {
  if (base == null || value == null) return null;
  const d = value - base;
  if (d === 0) return <span style={{ color: colors.textFaint, marginLeft: space.sm, fontSize: type.meta }}>same</span>;
  return (
    <span style={{ color: d > 0 ? colors.danger : colors.success, marginLeft: space.sm, fontSize: type.meta }}>
      {d > 0 ? "+" : "−"}{Math.abs(d)}
    </span>
  );
}

function runLabel(job, i) {
  return (
    <>
      <span style={{ color: colors.text, fontFamily: font.sans, fontWeight: 600 }}>Run {i + 1}{i === 0 ? " · reference" : ""}</span>
      <span style={{ marginLeft: space.sm }}>
        {job.users} users{Array.isArray(job.child_jobs) ? ", split" : ""}
        {job.status !== "completed" && (
          <span style={{ color: colors.text }}>, {job.status === "cancelled" ? "cancelled — partial" : job.status}</span>
        )}
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

export default function CompareView({ jobs, caseComparison, configs = [] }) {
  const reports = jobs.map((j, i) => runReport(j, configs[i] || null));
  const totals = reports.map((r) => r.aggregated);
  const anyGroup = jobs.some((j) => Array.isArray(j.child_jobs));

  // Volume figures (requests, requests/s) are neutral: a jump can just as
  // well mean fast 429 rejections. Only quality figures are good or bad.
  const metrics = [
    { label: "Requests", get: (t, i) => reports[i].requests, fmt: (v) => Math.round(v).toLocaleString(), goodWhenUp: null },
    { label: "Unexpected answers", get: (t, i) => reports[i].unexpectedPct, fmt: (v) => formatPct(v), goodWhenUp: false },
    { label: "Cases with bugs", get: (t, i) => reports[i].bugCaseCount, fmt: (v) => String(v), absolute: true },
    { label: "Cases not tested", get: (t, i) => reports[i].untested.length, fmt: (v) => String(v), absolute: true },
    { label: "Average response (ms)", get: (t) => num(t, "Average Response Time"), fmt: (v) => Math.round(v), goodWhenUp: false },
    { label: anyGroup ? "p95 response (ms, ≈ for split runs)" : "p95 response (ms)", get: (t) => num(t, "95%"), fmt: (v) => Math.round(v), goodWhenUp: false, approxForSplit: true },
    { label: "Requests / s", get: (t) => num(t, "Requests/s"), fmt: (v) => v.toFixed(1), goodWhenUp: null },
  ];

  const ref = reports[0];
  const sentences = reports.slice(1).map((r, k) => {
    const i = k + 1;
    const parts = [];
    if (ref.unexpectedPct != null && r.unexpectedPct != null) {
      const d = r.unexpectedPct - ref.unexpectedPct;
      parts.push(Math.abs(d) < 0.5 ? "unexpected answers about the same" : `unexpected answers ${d > 0 ? "rose" : "fell"} from ${formatPct(ref.unexpectedPct)} to ${formatPct(r.unexpectedPct)}`);
    }
    if (ref.p95 != null && r.p95 != null && ref.p95 > 0) {
      const d = ((r.p95 - ref.p95) / ref.p95) * 100;
      parts.push(Math.abs(d) < 5 ? "p95 about the same" : `p95 ${d > 0 ? "rose" : "fell"} from ${Math.round(ref.p95)} to ${Math.round(r.p95)} ms`);
    }
    const rl = r.loadEffects.find((g) => g.kind === "rate_limited");
    if (rl) parts.push(`${formatPct((rl.total / (r.requests || 1)) * 100)} rate limited`);
    return `Run ${i + 1} (${jobs[i].users} users) compared with the reference: ${parts.join("; ") || "no comparable figures"}.`;
  });

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
      <h2 style={{ fontSize: type.heading, fontWeight: 600, margin: `0 0 ${space.sm}px` }}>What changed</h2>
      <ul style={{ margin: `0 0 ${space.lg}px`, paddingLeft: space.lg, display: "grid", gap: space.xs, fontSize: type.body, maxWidth: "80ch" }}>
        {sentences.map((t) => <li key={t}>{t}</li>)}
      </ul>
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
            {jobs.some((j) => j.slo_verdict) && (
              <tr>
                <td style={{ ...tdStyle, color: colors.textMuted, fontFamily: font.sans }}>SLO verdict</td>
                {jobs.map((j, i) => (
                  <td key={i} style={tdStyle}>
                    {j.slo_verdict?.verdict ? <VerdictChip verdict={j.slo_verdict.verdict} /> : "—"}
                    {j.slo_verdict && (
                      <span style={{ marginLeft: space.sm, fontSize: type.meta, color: colors.textMuted }}>
                        {j.slo_verdict.passed}/{j.slo_verdict.passed + j.slo_verdict.failed} met
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            )}
            <tr>
              <td style={{ ...tdStyle, color: colors.textMuted, fontFamily: font.sans }}>How requests were answered</td>
              {jobs.map((j, i) => (
                <td key={i} style={tdStyle}>
                  <OutcomeStrip
                    requests={reports[i].requests}
                    kindCounts={reports[i].kinds}
                    failureTotal={reports[i].unexpected}
                    passedLabel="Expected answer"
                  />
                </td>
              ))}
            </tr>
            {metrics.map((m) => {
              const base = m.get(totals[0], 0);
              return (
                <tr key={m.label}>
                  <td style={{ ...tdStyle, color: colors.textMuted, fontFamily: font.sans }}>{m.label}</td>
                  {totals.map((t, i) => {
                    const v = m.get(t, i);
                    return (
                      <td key={i} style={tdStyle}>
                        {v != null && m.approxForSplit && Array.isArray(jobs[i].child_jobs) ? "≈" : ""}
                        {v != null ? m.fmt(v) : "—"}
                        {i > 0 && (m.absolute ? <AbsDelta base={base} value={v} /> : <Delta base={base} value={v} goodWhenUp={m.goodWhenUp} />)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <td style={{ ...tdStyle, color: colors.textMuted, fontFamily: font.sans }}>Duration (s)</td>
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
        ▲ / ▼ show the change against Run 1, the reference run. Red is worse, green is better; volume figures such as requests are neutral.
      </p>

      {rows.length > 0 && (
        <>
          <h2 style={{ fontSize: type.heading, fontWeight: 600, marginTop: space.xl, marginBottom: space.xs }}>Unexpected share per case</h2>
          <p style={{ fontSize: type.body, color: colors.textMuted, marginTop: 0, maxWidth: "70ch" }}>
            Each cell is that case's share of unexpected answers in that run, with its request count (n). Faint
            cells had fewer than {caseComparison.min_requests} requests, so they are not used to decide
            whether a case changed. A case counts as changed with load when its share differs
            by {caseComparison.threshold} percentage points or more between any two runs.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Case</th>
                  {jobs.map((j, i) => (
                    <th key={i} style={thStyle}>Run {i + 1}{i === 0 ? " (reference)" : ""}, {j.users} users</th>
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
                  <tr key={r.case} style={{ background: colors.surfaceRaised }}>
                    <td style={tdStyle}>
                      {r.case}
                      <span style={{ color: colors.text, fontWeight: 600, fontSize: type.meta, marginLeft: space.sm }}>
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
