import { formatTime } from "../../utils/formatTime";
import Icon from "../Icon";
import { colors } from "../../theme";

// How this run compares with its target's baseline (/api/regressions).
// "Got worse" means a case's unexpected share rose by the threshold or more.
export default function BaselineComparison({ info, approximate = false }) {
  if (!info) return null;
  if (info.is_current_baseline) {
    return (
      <p className="baseline-note">
        <Icon name="star" color={colors.text} /> This run is the baseline for{" "}
        <span className="mono">{info.target_url}</span>. Later runs of this target are compared with it.
      </p>
    );
  }
  if (!info.baseline) return null;
  const change = info.p95_change_pct;
  const worse = info.regressions || [];
  const approx = approximate || info.baseline.is_group ? "≈" : "";

  return (
    <section className="block" aria-labelledby="baseline-title">
      <div className="block-head">
        <h3 id="baseline-title">Compared with the baseline</h3>
        <span className="muted">
          <span className="num">{info.baseline.users}</span> users, {formatTime(info.baseline.created_at)}
        </span>
      </div>
      <p className="baseline-line">
        {worse.length === 0 ? (
          <><Icon name="check" color={colors.success} /> No case got worse than the baseline.</>
        ) : (
          <>
            <Icon name="cross" color={colors.danger} />{" "}
            <strong>{worse.length} case{worse.length === 1 ? "" : "s"} got worse</strong>: their unexpected share rose by{" "}
            {info.threshold} points or more (cases with at least {info.min_requests} requests in both runs).
          </>
        )}
      </p>
      <p className="baseline-line">
        p95 response{" "}
        {change == null ? (
          <span className="muted">could not be compared</span>
        ) : (
          <>
            <span className="num" style={{ color: change > 0 ? colors.danger : colors.text }}>
              {change > 0 ? "+" : ""}{change}%
            </span>{" "}
            <span className="muted">
              (<span className="num">{approx}{Math.round(info.baseline_p95 ?? 0)}</span> ms to{" "}
              <span className="num">{approx}{Math.round(info.current_p95 ?? 0)}</span> ms)
            </span>
          </>
        )}
      </p>
      {worse.length > 0 && (
        <div className="table-scroll is-capped">
          <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th className="num">Baseline</th>
                <th className="num">This run</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {worse.map((r) => (
                <tr key={r.case}>
                  <td className="case-name">{r.case}</td>
                  <td className="num">{r.baseline_rate}%</td>
                  <td className="num" style={{ color: colors.danger }}>{r.current_rate}%</td>
                  <td className="num">+{r.increase} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
