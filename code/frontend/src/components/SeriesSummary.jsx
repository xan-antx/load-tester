import { thStyle, tdStyle, tableStyle } from "./Section";
import { colors, font, space, type } from "../theme";

// Result of a repeat series: the spread across repeats for the run as a
// whole (mean ± standard deviation) and per case (mean failure rate and its
// min–max). The numbers come from the backend's analysis/series_stats.py.

const fmt = (v, digits) => (v == null ? "—" : Number(v).toFixed(digits));

function meanStd(s, digits) {
  if (!s || s.mean == null) return "—";
  return s.std == null ? fmt(s.mean, digits) : `${fmt(s.mean, digits)} ± ${fmt(s.std, digits)}`;
}

export default function SeriesSummary({ data }) {
  const summary = data.series_summary;
  const runs = data.runs || [];
  const completed = runs.filter((r) => r.status === "completed").length;
  const anySplit = runs.some((r) => r.is_group);

  const overallRows = summary
    ? [
        { label: "Throughput (requests / s)", s: summary.overall.throughput, digits: 2 },
        { label: anySplit ? "p95 response (ms, ≈ for split runs)" : "p95 response (ms)", s: summary.overall.p95, digits: 0 },
        { label: "Problem rate (%)", s: summary.overall.problem_rate, digits: 1 },
      ]
    : [];

  return (
    <div style={{ marginTop: space.lg }}>
      <h3 style={{ margin: `0 0 ${space.xs}px`, fontSize: type.heading, fontWeight: 600 }}>Series summary</h3>
      <p style={{ margin: `0 0 ${space.md}px`, fontSize: type.meta, color: colors.textMuted, maxWidth: "75ch" }}>
        The same test was set to run {data.repeat_count} times, one after another ({data.users} users,{" "}
        {data.duration_seconds} s each). {completed < data.repeat_count && (
          <span style={{ color: colors.warning }}>
            Only {completed} of {data.repeat_count} repeats completed
            {data.status === "cancelled" ? " before the series was stopped" : ""}.{" "}
          </span>
        )}
        Each repeat is also an ordinary run in the list below, so it can be opened in Compare runs.
      </p>

      {!summary && (
        <p style={{ fontSize: type.body, color: colors.textMuted }}>No repeat completed, so there is nothing to summarise.</p>
      )}

      {summary && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Whole run</th>
                  <th style={thStyle}>Mean ± SD</th>
                  <th style={thStyle}>Each repeat</th>
                </tr>
              </thead>
              <tbody>
                {overallRows.map((r) => (
                  <tr key={r.label}>
                    <td style={{ ...tdStyle, fontFamily: font.sans, color: colors.textMuted }}>{r.label}</td>
                    <td style={tdStyle}>{meanStd(r.s, r.digits)}</td>
                    <td style={{ ...tdStyle, color: colors.textMuted }}>
                      {r.s.values.map((v) => fmt(v, r.digits)).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: type.meta, color: colors.textMuted, marginTop: space.xs, maxWidth: "75ch" }}>
            SD is the sample standard deviation across the completed repeats: a small SD means the result
            is repeatable, a large one means a single run could mislead.
          </p>

          <h3 style={{ fontSize: type.body, fontWeight: 600, margin: `${space.lg}px 0 ${space.xs}px` }}>
            Failure rate per case across repeats
          </h3>
          <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Case</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Mean fail %</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Min – max</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Repeats</th>
                </tr>
              </thead>
              <tbody>
                {summary.cases.map((c) => {
                  const wide = c.max_rate - c.min_rate >= 10;
                  return (
                    <tr key={c.case}>
                      <td style={tdStyle}>{c.case}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(c.mean_rate, 1)}</td>
                      <td
                        style={{ ...tdStyle, textAlign: "right", color: wide ? colors.warning : colors.textMuted }}
                        title={wide ? "Varies by 10 points or more between repeats" : undefined}
                      >
                        {fmt(c.min_rate, 0)} – {fmt(c.max_rate, 0)}
                        {wide && <span className="visually-hidden"> (varies a lot)</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", color: colors.textMuted }}>{c.runs}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p style={{ fontSize: type.meta, color: colors.textMuted, fontFamily: font.mono, marginTop: space.md }}>
        Repeats:{" "}
        {runs.map((r, i) => `#${i + 1} ${r.status}${r.is_group ? " (split)" : ""}`).join(" · ") || "none started"}
      </p>
    </div>
  );
}
