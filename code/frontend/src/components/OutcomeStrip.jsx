import { colors, font, outcome, radius, space, type } from "../theme";
import { outcomeSegments } from "../utils/outcomes";

// A segmented bar showing how requests ended: passed / 4xx / 429 / 5xx /
// connection. Segment widths are proportional to request counts.
// size "large" adds a legend with counts; "small" is the per-row version.
export default function OutcomeStrip({ requests, kindCounts, failureTotal, size = "small" }) {
  const segments = outcomeSegments(requests, kindCounts, failureTotal);
  const total = segments.reduce((s, x) => s + x.count, 0);
  const large = size === "large";
  const description = segments
    .map((s) => `${outcome[s.key].label}: ${s.count}`)
    .join(", ");

  return (
    <div>
      <div
        role="img"
        aria-label={total ? `Request outcomes. ${description}` : "No requests"}
        title={description}
        style={{
          display: "flex",
          gap: 1,
          height: large ? 10 : 6,
          minWidth: large ? undefined : 90,
          background: colors.track,
          borderRadius: radius.sm,
          overflow: "hidden",
        }}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ flexGrow: s.count, flexBasis: 0, background: outcome[s.key].fg, minWidth: 2 }}
          />
        ))}
      </div>
      {large && total > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: `${space.xs}px ${space.lg}px`, marginTop: space.sm }}>
          {segments.map((s) => (
            <span
              key={s.key}
              style={{ display: "inline-flex", alignItems: "center", gap: space.sm, fontSize: type.meta, color: colors.textMuted }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: outcome[s.key].fg }} />
              {outcome[s.key].label}
              <span style={{ fontFamily: font.mono, color: colors.text }}>
                {s.count.toLocaleString()}
              </span>
              <span style={{ fontFamily: font.mono, color: colors.textFaint }}>
                {((s.count / total) * 100).toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
