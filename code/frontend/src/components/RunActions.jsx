import { btnStyle } from "./Section";
import { formatTime } from "../utils/formatTime";
import { buildMarkdownReport, downloadTextFile } from "../utils/report";
import { colors, font, space, radius } from "../theme";

// Below a completed result: baseline status / regressions, plus the
// "Mark as baseline" and "Download report" buttons.
export default function RunActions({ run, regressionInfo, onMarkBaseline, markingBaseline }) {
  const id = run.job_id || run.group_id;
  const completed = run.status === "completed";

  function downloadReport() {
    const text = buildMarkdownReport(run, regressionInfo);
    downloadTextFile(`load-test-report-${String(id).slice(0, 8)}.md`, text);
  }

  const secondaryBtn = {
    ...btnStyle,
    background: "transparent",
    color: colors.accent,
    border: `1px solid ${colors.border}`,
    marginRight: space.sm,
  };

  const info = regressionInfo;
  const p95Change = info?.p95_change_pct;

  return (
    <div style={{ marginTop: space.md }}>
      {info?.baseline && (
        <div
          style={{
            padding: space.md,
            border: `1px solid ${colors.borderSubtle}`,
            borderRadius: radius.md,
            background: colors.surfaceRaised,
            marginBottom: space.sm,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: space.xs }}>
            Compared with baseline
            <span style={{ fontWeight: 400, color: colors.textMuted, marginLeft: space.sm, fontSize: 12 }}>
              {info.baseline.users} users · {formatTime(info.baseline.created_at)}
            </span>
          </div>
          <div style={{ fontSize: 12.5, marginBottom: space.xs }}>
            p95 response:{" "}
            {p95Change == null ? (
              <span style={{ color: colors.textMuted }}>unknown</span>
            ) : (
              <span style={{ color: p95Change > 0 ? colors.danger : colors.success, fontWeight: 600 }}>
                {p95Change > 0 ? "▲" : "▼"} {Math.abs(p95Change)}%
              </span>
            )}
            <span style={{ color: colors.textMuted, fontFamily: font.mono, fontSize: 11.5, marginLeft: 6 }}>
              ({Math.round(info.baseline_p95 ?? 0)} → {Math.round(info.current_p95 ?? 0)} ms)
            </span>
          </div>
          {info.regressions.length === 0 ? (
            <div style={{ fontSize: 12.5, color: colors.success }}>
              No case's failure rate rose by {info.threshold}+ points.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: colors.danger, marginBottom: space.xs }}>
                {info.regressions.length} case{info.regressions.length === 1 ? "" : "s"} got worse by{" "}
                {info.threshold}+ points (both runs ≥ {info.min_requests} requests):
              </div>
              {info.regressions.map((r) => (
                <div key={r.case} style={{ fontFamily: font.mono, fontSize: 12, color: colors.text }}>
                  {r.case}: {r.baseline_rate}% → <span style={{ color: colors.danger }}>{r.current_rate}%</span>
                  <span style={{ color: colors.textMuted }}> (+{r.increase} pts)</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {info?.is_current_baseline && (
        <div style={{ fontSize: 12.5, color: colors.accent, marginBottom: space.xs }}>
          ★ This run is the baseline for {info.target_url}. Later runs of this target are compared with it.
        </div>
      )}

      {completed && !info?.is_current_baseline && (
        <button onClick={onMarkBaseline} style={secondaryBtn} disabled={markingBaseline}>
          {markingBaseline ? "Saving…" : "Mark as baseline"}
        </button>
      )}
      {completed && (
        <button onClick={downloadReport} style={secondaryBtn}>
          Download report (.md)
        </button>
      )}
    </div>
  );
}
