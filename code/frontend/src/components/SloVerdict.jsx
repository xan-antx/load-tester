import { colors, font, radius, space, type } from "../theme";

// The PASS / FAIL banner of a finished run, with one line per threshold:
// target, measured value, and whether it held.

const fmt = (v, unit) => (v == null ? "—" : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`);

export function VerdictChip({ verdict }) {
  if (!verdict) return null;
  const pass = verdict === "PASS";
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: type.meta,
        fontWeight: 600,
        color: pass ? colors.success : colors.danger,
        border: `1px solid ${pass ? colors.success : colors.danger}`,
        borderRadius: radius.sm,
        padding: `0 ${space.xs}px`,
        lineHeight: "18px",
      }}
    >
      {verdict}
    </span>
  );
}

// approximate: the run was split into parallel Locust processes, so its p95
// is a merged estimate; the p95 check's measured value is marked "≈".
export default function SloVerdict({ verdict, approximate = false }) {
  if (!verdict) return null;
  const pass = verdict.verdict === "PASS";
  const unknown = verdict.verdict == null;
  const tone = unknown ? colors.textMuted : pass ? colors.success : colors.danger;
  const measured = verdict.passed + verdict.failed;

  return (
    <section
      aria-label="SLO verdict"
      style={{
        border: `1px solid ${tone}`,
        borderLeft: `4px solid ${tone}`,
        background: unknown ? colors.mutedSoft : pass ? colors.successSoft : colors.dangerSoft,
        borderRadius: radius.md,
        padding: `${space.md}px ${space.lg}px`,
        marginBottom: space.lg,
      }}
    >
      <div role="status" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: space.md }}>
        <span style={{ fontFamily: font.mono, fontSize: type.readout, fontWeight: 600, color: tone, lineHeight: 1.1 }}>
          SLO {unknown ? "NOT MEASURED" : verdict.verdict}
        </span>
        <span style={{ fontSize: type.body, color: colors.text }}>
          {unknown
            ? "None of the thresholds could be measured for this run."
            : `${verdict.passed} of ${measured} threshold${measured === 1 ? "" : "s"} met`}
          {verdict.not_measured > 0 && `, ${verdict.not_measured} not measurable`}
        </span>
      </div>
      <ul style={{ listStyle: "none", margin: `${space.sm}px 0 0`, padding: 0, display: "grid", gap: space.xs }}>
        {verdict.checks.map((c) => {
          const mark = c.passed === true ? "✓" : c.passed === false ? "✗" : "–";
          const color = c.passed === true ? colors.success : c.passed === false ? colors.danger : colors.textMuted;
          const approx = approximate && c.key === "p95_ms" && c.passed != null;
          return (
            <li key={c.key} style={{ display: "flex", flexWrap: "wrap", gap: space.sm, fontSize: type.body }}>
              <span aria-hidden="true" style={{ color, fontFamily: font.mono, width: 14 }}>{mark}</span>
              <span style={{ minWidth: 220, color: colors.text }}>{c.label}</span>
              <span style={{ fontFamily: font.mono, color: colors.textMuted }}>
                target {c.comparison === "<=" ? "≤" : "≥"} {fmt(c.target, c.unit)}
              </span>
              <span
                style={{ fontFamily: font.mono, color }}
                title={approx ? "Merged p95 of a split run: an approximation, not a true percentile of all requests." : undefined}
              >
                {c.passed == null ? "not measured" : `actual ${approx ? "≈" : ""}${fmt(c.actual, c.unit)}`}
                {approx && <span className="visually-hidden"> (approximate, split run)</span>}
              </span>
              <span className="visually-hidden">
                {c.passed === true ? "met" : c.passed === false ? "missed" : "not measured"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
