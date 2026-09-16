import { btnStyle, preStyle, thStyle, tdStyle } from "./Section";
import { parseStatsCsv } from "../utils/parseStatsCsv";

export default function JobResultSummary({ data, showRaw, onToggleRaw }) {
  const rows = parseStatsCsv(data.stats_csv);
  const nonAggregated = rows.filter((r) => r.Name && r.Name !== "Aggregated");
  const aggregated = rows.find((r) => r.Name === "Aggregated");

  return (
    <div style={{ marginTop: 10 }}>
      {data.status === "failed" && data.error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 6 }}>
          Error: {data.error}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
                <th style={thStyle}>Edge Case</th>
                <th style={thStyle}>Requests</th>
                <th style={thStyle}>Failures</th>
                <th style={thStyle}>Avg (ms)</th>
                <th style={thStyle}>Min (ms)</th>
                <th style={thStyle}>Max (ms)</th>
              </tr>
            </thead>
            <tbody>
              {nonAggregated.map((r, i) => {
                const failed = Number(r["Failure Count"]) > 0;
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={tdStyle}>{r.Name}</td>
                    <td style={tdStyle}>{r["Request Count"]}</td>
                    <td style={{ ...tdStyle, color: failed ? "#b91c1c" : "#15803d", fontWeight: 600 }}>
                      {r["Failure Count"]}
                    </td>
                    <td style={tdStyle}>{Math.round(Number(r["Average Response Time"]))}</td>
                    <td style={tdStyle}>{Math.round(Number(r["Min Response Time"]))}</td>
                    <td style={tdStyle}>{Math.round(Number(r["Max Response Time"]))}</td>
                  </tr>
                );
              })}
              {aggregated && (
                <tr style={{ fontWeight: 700, borderTop: "2px solid #ddd" }}>
                  <td style={tdStyle}>Total</td>
                  <td style={tdStyle}>{aggregated["Request Count"]}</td>
                  <td style={{ ...tdStyle, color: Number(aggregated["Failure Count"]) > 0 ? "#b91c1c" : "#15803d" }}>
                    {aggregated["Failure Count"]}
                  </td>
                  <td style={tdStyle}>{Math.round(Number(aggregated["Average Response Time"]))}</td>
                  <td style={tdStyle}>{Math.round(Number(aggregated["Min Response Time"]))}</td>
                  <td style={tdStyle}>{Math.round(Number(aggregated["Max Response Time"]))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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