import { thStyle, tdStyle } from "./Section";
import { parseStatsCsv } from "../utils/parseStatsCsv";

export default function CompareView({ jobA, jobB }) {
  const aRows = parseStatsCsv(jobA.stats_csv);
  const bRows = parseStatsCsv(jobB.stats_csv);
  const aTotal = aRows.find((r) => r.Name === "Aggregated");
  const bTotal = bRows.find((r) => r.Name === "Aggregated");

  const metricRow = (label, aVal, bVal) => (
    <tr style={{ borderBottom: "1px solid #eee" }}>
      <td style={tdStyle}>{label}</td>
      <td style={tdStyle}>{aVal}</td>
      <td style={tdStyle}>{bVal}</td>
    </tr>
  );

  return (
    <div style={{ marginTop: 15, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
            <th style={thStyle}>Metric</th>
            <th style={thStyle}>Run A ({jobA.users}u)</th>
            <th style={thStyle}>Run B ({jobB.users}u)</th>
          </tr>
        </thead>
        <tbody>
          {metricRow("Total Requests", aTotal?.["Request Count"] ?? "—", bTotal?.["Request Count"] ?? "—")}
          {metricRow("Total Failures", aTotal?.["Failure Count"] ?? "—", bTotal?.["Failure Count"] ?? "—")}
          {metricRow(
            "Avg Response (ms)",
            aTotal ? Math.round(Number(aTotal["Average Response Time"])) : "—",
            bTotal ? Math.round(Number(bTotal["Average Response Time"])) : "—"
          )}
          {metricRow(
            "Requests/sec",
            aTotal ? Number(aTotal["Requests/s"]).toFixed(2) : "—",
            bTotal ? Number(bTotal["Requests/s"]).toFixed(2) : "—"
          )}
          {metricRow("Duration (s)", jobA.duration_seconds, jobB.duration_seconds)}
        </tbody>
      </table>
    </div>
  );
}