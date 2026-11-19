import Icon from "./Icon";
import Popover from "./Popover";
import { colors } from "../theme";
import { SLO_LABELS } from "../utils/runReport";

// The SLO check of a finished run: a secondary card under the findings.
// One row per threshold: target, measured value, and whether it held.

const fmt = (v, unit) =>
  v == null ? "—" : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: unit === "%" ? 1 : 0 })}${unit === "%" ? "%" : ` ${unit}`}`;

export function VerdictChip({ verdict }) {
  if (!verdict) return <span className="muted">—</span>;
  const pass = verdict === "PASS";
  return (
    <span className={`verdict-chip ${pass ? "is-pass" : "is-fail"}`}>
      <Icon name={pass ? "check" : "cross"} size={12} />
      {verdict}
    </span>
  );
}

// approximate: the run was split into parallel processes, so its p95 is a
// merged estimate; the p95 check's measured value is marked "≈".
export default function SloVerdict({ verdict, approximate = false }) {
  if (!verdict) return null;
  const pass = verdict.verdict === "PASS";
  const unknown = verdict.verdict == null;
  const tone = unknown ? "is-unknown" : pass ? "is-pass" : "is-fail";
  const measured = verdict.passed + verdict.failed;

  return (
    <section aria-labelledby="slo-title" className={`slo-card ${tone}`}>
      <div className="slo-head">
        <h3 id="slo-title" className="slo-title">
          Performance targets (SLO)
          <Popover label="How the SLO is judged">
            Each target you set is checked against the whole run. The run passes only when every
            measured target holds. A target that could not be measured (for example no requests) is
            shown as not measured and does not count. p95 is the time 95% of requests beat.
          </Popover>
        </h3>
        <div role="status" className="slo-verdict">
          <span className="slo-word">{unknown ? "Not measured" : pass ? "PASS" : "FAIL"}</span>
          <span className="slo-count">
            {unknown
              ? "none of the targets could be measured"
              : `${verdict.passed} of ${measured} target${measured === 1 ? "" : "s"} met`}
            {verdict.not_measured > 0 && `, ${verdict.not_measured} not measurable`}
          </span>
        </div>
      </div>
      <ul className="slo-checks">
        {verdict.checks.map((c) => {
          const state = c.passed === true ? "met" : c.passed === false ? "missed" : "not measured";
          const color = c.passed === true ? colors.success : c.passed === false ? colors.danger : colors.textMuted;
          const approx = approximate && c.key === "p95_ms" && c.passed != null;
          return (
            <li key={c.key}>
              <Icon name={c.passed === true ? "check" : c.passed === false ? "cross" : "dash"} color={color} />
              <span className="slo-label">{SLO_LABELS[c.key] || c.label}</span>
              <span className="slo-target">
                target {c.comparison === "<=" ? "≤" : "≥"} <span className="num">{fmt(c.target, c.unit)}</span>
              </span>
              <span className="slo-actual" style={{ color }}>
                {c.passed == null ? "not measured" : <>measured <span className="num">{approx ? "≈" : ""}{fmt(c.actual, c.unit)}</span></>}
              </span>
              <span className="slo-state" style={{ color }}>{state}</span>
              {approx && <span className="visually-hidden"> (approximate, split run)</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
