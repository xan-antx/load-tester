import { thStyle, tdStyle } from "./Section";
import { parseStatsCsv } from "../utils/parseStatsCsv";
import { colors, space } from "../theme";

function num(row, key) {
  if (!row || row[key] == null) return null;
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : null;
}

function failureRate(row) {
  const req = num(row, "Request Count");
  const fail = num(row, "Failure Count");
  if (req == null || fail == null || req === 0) return null;
  return (fail / req) * 100;
}

// goodWhenUp: true = an increase is an improvement (green), false = an
// increase is a regression (red), null = neutral config value (no verdict).
function DeltaCell({ a, b, goodWhenUp }) {
  if (a == null || b == null || a === 0) {
    return <td style={{ ...tdStyle, color: colors.textMuted }}>—</td>;
  }
  const delta = ((b - a) / a) * 100;
  if (Math.abs(delta) < 0.05) {
    return <td style={{ ...tdStyle, color: colors.textMuted }}>0%</td>;
  }
  const up = delta > 0;
  const color =
    goodWhenUp == null
      ? colors.textMuted
      : up === goodWhenUp
        ? colors.success
        : colors.danger;
  return (
    <td style={{ ...tdStyle, color, fontWeight: 600, whiteSpace: "nowrap" }}>
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </td>
  );
}

export default function CompareView({ jobA, jobB }) {
  const aRows = parseStatsCsv(jobA.aggregated_stats_csv || jobA.stats_csv);
  const bRows = parseStatsCsv(jobB.aggregated_stats_csv || jobB.stats_csv);
  const aTotal = aRows.find((r) => r.Name === "Aggregated");
  const bTotal = bRows.find((r) => r.Name === "Aggregated");

  const metrics = [
    {
      label: "Total Requests",
      a: num(aTotal, "Request Count"),
      b: num(bTotal, "Request Count"),
      fmt: (v) => Math.round(v),
      goodWhenUp: true,
    },
    {
      label: "Total Failures",
      a: num(aTotal, "Failure Count"),
      b: num(bTotal, "Failure Count"),
      fmt: (v) => Math.round(v),
      goodWhenUp: false,
    },
    {
      label: "Failure Rate (%)",
      a: failureRate(aTotal),
      b: failureRate(bTotal),
      fmt: (v) => v.toFixed(1),
      goodWhenUp: false,
    },
    {
      label: "Avg Response (ms)",
      a: num(aTotal, "Average Response Time"),
      b: num(bTotal, "Average Response Time"),
      fmt: (v) => Math.round(v),
      goodWhenUp: false,
    },
    {
      label: "Requests/sec",
      a: num(aTotal, "Requests/s"),
      b: num(bTotal, "Requests/s"),
      fmt: (v) => v.toFixed(2),
      goodWhenUp: true,
    },
    {
      label: "Duration (s)",
      a: jobA.duration_seconds != null ? Number(jobA.duration_seconds) : null,
      b: jobB.duration_seconds != null ? Number(jobB.duration_seconds) : null,
      fmt: (v) => v,
      goodWhenUp: null,
    },
  ];

  return (
    <div style={{ marginTop: space.lg, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${colors.border}`, textAlign: "left" }}>
            <th style={thStyle}>Metric</th>
            <th style={thStyle}>Run A ({jobA.users}u)</th>
            <th style={thStyle}>Run B ({jobB.users}u)</th>
            <th style={thStyle}>Change (B vs A)</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.label} style={{ borderBottom: `1px solid ${colors.borderSubtle}` }}>
              <td style={tdStyle}>{m.label}</td>
              <td style={tdStyle}>{m.a != null ? m.fmt(m.a) : "—"}</td>
              <td style={tdStyle}>{m.b != null ? m.fmt(m.b) : "—"}</td>
              <DeltaCell a={m.a} b={m.b} goodWhenUp={m.goodWhenUp} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
