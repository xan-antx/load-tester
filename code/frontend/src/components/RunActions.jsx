import { secondaryBtnStyle, subPanelStyle, withDisabled } from "./Section";
import { formatTime } from "../utils/formatTime";
import { buildMarkdownReport, downloadTextFile } from "../utils/report";
import { colors, font, space, type } from "../theme";

// Below a completed result: baseline status / regressions, plus the
// "Mark as baseline" and "Download report" buttons.
export default function RunActions({ run, regressionInfo, onMarkBaseline, markingBaseline }) {
  const id = run.job_id || run.group_id;
  const completed = run.status === "completed";

  function downloadReport() {
    const text = buildMarkdownReport(run, regressionInfo);
    downloadTextFile(`load-test-report-${String(id).slice(0, 8)}.md`, text);
  }

  const btn = { ...secondaryBtnStyle, marginRight: space.sm };
  const info = regressionInfo;
  const p95Change = info?.p95_change_pct;

  return (
    <div style={{ marginTop: space.lg }}>
      {info?.baseline && (
        <div style={{ ...subPanelStyle, padding: space.md, marginBottom: space.sm }}>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: space.sm, marginBottom: space.sm }}>
            <h3 style={{ margin: 0, fontSize: type.body, fontWeight: 600 }}>Compared with the baseline run</h3>
            <span style={{ fontFamily: font.mono, fontSize: type.label, color: colors.textMuted }}>
              {info.baseline.users} users, {formatTime(info.baseline.created_at)}
            </span>
          </div>
          <div style={{ fontSize: type.body, marginBottom: space.sm }}>
            p95 response{" "}
            {p95Change == null ? (
              <span style={{ color: colors.textMuted }}>unknown</span>
            ) : (
              <span style={{ fontFamily: font.mono, color: p95Change > 0 ? colors.danger : colors.success }}>
                {p95Change > 0 ? "▲" : "▼"} {Math.abs(p95Change)}%
              </span>
            )}
            <span style={{ color: colors.textMuted, fontFamily: font.mono, fontSize: type.label, marginLeft: space.sm }}>
              {Math.round(info.baseline_p95 ?? 0)} ms to {Math.round(info.current_p95 ?? 0)} ms
            </span>
          </div>
          {info.regressions.length === 0 ? (
            <div style={{ fontSize: type.body, color: colors.textMuted }}>
              No case's failure rate rose by {info.threshold} or more points.
            </div>
          ) : (
            <>
              <div style={{ fontSize: type.body, color: colors.text, marginBottom: space.xs }}>
                <span style={{ color: colors.danger }}>
                  {info.regressions.length} case{info.regressions.length === 1 ? "" : "s"} got worse
                </span>{" "}
                by {info.threshold} or more points (both runs with at least {info.min_requests} requests):
              </div>
              <table style={{ borderCollapse: "collapse", fontFamily: font.mono, fontSize: 12.5 }}>
                <tbody>
                  {info.regressions.map((r) => (
                    <tr key={r.case}>
                      <td style={{ padding: "2px 16px 2px 0", color: colors.text }}>{r.case}</td>
                      <td style={{ padding: "2px 8px", color: colors.textMuted, textAlign: "right" }}>{r.baseline_rate}%</td>
                      <td style={{ padding: "2px 8px", color: colors.textFaint }}>to</td>
                      <td style={{ padding: "2px 8px", color: colors.danger, textAlign: "right" }}>{r.current_rate}%</td>
                      <td style={{ padding: "2px 8px", color: colors.textMuted }}>+{r.increase} pts</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {info?.is_current_baseline && (
        <p style={{ fontSize: type.body, color: colors.text, margin: `0 0 ${space.xs}px` }}>
          <span style={{ color: colors.accent }}>★</span> This run is the baseline for{" "}
          <span style={{ fontFamily: font.mono }}>{info.target_url}</span>. Later runs of this target are
          compared with it.
        </p>
      )}

      {completed && !info?.is_current_baseline && (
        <button onClick={onMarkBaseline} style={withDisabled(btn, markingBaseline)} disabled={markingBaseline}>
          {markingBaseline ? "Saving…" : "Mark as baseline"}
        </button>
      )}
      {completed && (
        <button onClick={downloadReport} style={btn}>
          Download report (.md)
        </button>
      )}
    </div>
  );
}
