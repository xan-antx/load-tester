import { inputStyle, labelStyle } from "./Section";
import { colors, space, type } from "../theme";

// The thresholds a run is judged against (analysis/slo.py on the backend).
// Values are kept as text while typing; an empty field means "not checked".
export const SLO_FIELDS = [
  { key: "p95_ms", label: "p95 response ≤ (ms)", min: 1, max: 600000 },
  { key: "max_server_error_rate_pct", label: "Server errors ≤ (%), 5xx + no answer", min: 0, max: 100 },
  { key: "max_unexpected_outcome_rate_pct", label: "Unexpected answers ≤ (%)", min: 0, max: 100 },
  { key: "avg_ms", label: "Average response ≤ (ms)", min: 1, max: 600000 },
  { key: "min_rps", label: "Throughput ≥ (requests / s)", min: 0, max: 100000 },
];

export const DEFAULT_SLO = {
  p95_ms: "500",
  max_server_error_rate_pct: "1",
  max_unexpected_outcome_rate_pct: "",
  avg_ms: "",
  min_rps: "",
};

// { key: number } of the filled-in fields, or undefined when off or empty
// (undefined is left out of the JSON request body).
export function sloPayload(enabled, values) {
  if (!enabled) return undefined;
  const out = {};
  SLO_FIELDS.forEach(({ key }) => {
    const text = String(values[key] ?? "").trim();
    if (text !== "" && Number.isFinite(Number(text))) out[key] = Number(text);
  });
  return Object.keys(out).length ? out : undefined;
}

export default function SloConfig({ enabled, values, onEnabledChange, onValuesChange }) {
  return (
    <fieldset
      style={{
        margin: `${space.md}px 0 0`,
        padding: `${space.sm}px ${space.md}px ${space.md}px`,
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: 6,
      }}
    >
      <legend style={{ padding: `0 ${space.xs}px`, fontSize: type.body, fontWeight: 600 }}>SLO</legend>
      <label style={{ display: "flex", alignItems: "center", gap: space.sm, fontSize: type.body, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        Judge this run against service-level objectives (PASS / FAIL)
      </label>
      {enabled && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space.md, marginTop: space.sm }}>
            {SLO_FIELDS.map((f) => (
              <label key={f.key} style={{ flex: "1 1 170px" }}>
                <span style={labelStyle}>{f.label}</span>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step="any"
                  placeholder="not checked"
                  value={values[f.key]}
                  onChange={(e) => onValuesChange({ ...values, [f.key]: e.target.value })}
                  style={inputStyle}
                />
              </label>
            ))}
          </div>
          <p style={{ margin: `${space.sm}px 0 0`, fontSize: type.meta, color: colors.textMuted }}>
            Leave a field empty to skip it. "Unexpected answers" counts accepted invalid input and
            rejected valid input; 429 rate limiting is reported but is not an SLO failure.
          </p>
        </>
      )}
    </fieldset>
  );
}
