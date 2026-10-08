import { colors, outcome, space, type } from "../theme";

// The tone of a finding decides its marker colour; "worse" (a regression
// against the baseline) uses the error colour.
function toneColor(tone) {
  if (tone === "worse") return colors.danger;
  return (outcome[tone] || outcome.other).fg;
}

export default function Findings({ findings }) {
  if (!findings || findings.length === 0) return null;
  return (
    <div style={{ marginBottom: space.lg }}>
      <h3 style={{ margin: `0 0 ${space.sm}px`, fontSize: type.body, fontWeight: 600, color: colors.text }}>
        Findings
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {findings.map((f) => (
          <li key={f.text} style={{ display: "flex", alignItems: "baseline", gap: space.sm, fontSize: 15, color: colors.text }}>
            <span
              aria-hidden="true"
              style={{
                flex: "none",
                width: 10,
                height: 10,
                borderRadius: 2,
                background: toneColor(f.tone),
                transform: "translateY(1px)",
              }}
            />
            {f.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
