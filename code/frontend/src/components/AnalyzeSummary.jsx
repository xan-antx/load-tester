import { btnStyle, preStyle } from "./Section";

export default function AnalyzeSummary({ data, showRaw, onToggleRaw }) {
  const sanity = data.sanity || {};
  const type = data.type_detection || {};
  const sitemap = data.sitemap;

  const row = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
      <span style={{ color: "#555" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 14px" }}>
        {row("Reachable", sanity.reachable ? "✅ Yes" : "❌ No")}
        {row("Status Code", sanity.status_code ?? "—")}
        {row("Classification", type.classification ?? "unknown")}
        {sitemap && row("Sitemap Found", sitemap.found ? "✅ Yes" : "❌ No")}
        {sanity.error && row("Error", sanity.error)}
      </div>

      <button
        onClick={onToggleRaw}
        style={{ ...btnStyle, background: "transparent", color: "#2563eb", padding: "4px 0", marginTop: 8 }}
      >
        {showRaw ? "Hide raw response" : "Show raw response"}
      </button>

      {showRaw && <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}