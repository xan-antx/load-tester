import { linkBtnStyle, preStyle } from "./Section";
import { colors, font, radius, space, type } from "../theme";

// What /api/analyze found out about the target, as a small readout.
export default function AnalyzeSummary({ data, showRaw, onToggleRaw }) {
  const sanity = data.sanity || {};
  const typeInfo = data.type_detection || {};
  const sitemap = data.sitemap;

  const cells = [
    {
      label: "Reachable",
      value: sanity.reachable ? "Yes" : "No",
      color: sanity.reachable ? colors.success : colors.danger,
    },
    { label: "Status code", value: sanity.status_code ?? "—" },
    { label: "Looks like", value: typeInfo.classification ?? "unknown" },
  ];
  if (sitemap) cells.push({ label: "Sitemap", value: sitemap.found ? "Found" : "Not found" });

  return (
    <div style={{ marginTop: space.md }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 1,
          background: colors.borderSubtle,
          border: `1px solid ${colors.borderSubtle}`,
          borderRadius: radius.md,
          overflow: "hidden",
        }}
      >
        {cells.map((c) => (
          <div key={c.label} style={{ background: colors.surfaceRaised, padding: `${space.sm}px ${space.md}px` }}>
            <div style={{ fontFamily: font.mono, fontSize: type.label, color: colors.textMuted }}>{c.label}</div>
            <div style={{ fontFamily: font.mono, fontSize: 16, color: c.color || colors.text }}>{c.value}</div>
          </div>
        ))}
      </div>
      {sanity.error && (
        <p role="alert" style={{ color: colors.danger, fontSize: type.small, margin: `${space.sm}px 0 0` }}>
          {sanity.error}
        </p>
      )}

      <button onClick={onToggleRaw} aria-expanded={showRaw} style={{ ...linkBtnStyle, marginTop: space.xs }}>
        {showRaw ? "Hide raw response" : "Show raw response"}
      </button>

      {showRaw && <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
