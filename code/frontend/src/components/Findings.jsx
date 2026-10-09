import { colors, outcome, space, type } from "../theme";

// The tone of a finding decides its marker colour; "worse" (a regression
// against the baseline) uses the error colour.
function toneColor(tone) {
  if (tone === "worse") return colors.danger;
  return (outcome[tone] || outcome.other).fg;
}

// "Summary of results": two to four plain sentences, numbered, each with a
// square marker in its status colour.
export default function Findings({ findings }) {
  if (!findings || findings.length === 0) return null;
  return (
    <div style={{ marginBottom: space.xl, maxWidth: "75ch" }}>
      <h3 style={{ margin: `0 0 ${space.sm}px`, fontSize: type.heading, fontWeight: 600, color: colors.text }}>
        Summary of results
      </h3>
      <ol style={{ margin: 0, paddingLeft: space.xl, display: "grid", gap: space.sm, color: colors.textMuted }}>
        {findings.map((f) => (
          <li key={f.text} style={{ fontSize: type.heading, paddingLeft: space.xs }}>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                marginRight: space.sm,
                background: toneColor(f.tone),
              }}
            />
            <span style={{ color: colors.text }}>{f.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
