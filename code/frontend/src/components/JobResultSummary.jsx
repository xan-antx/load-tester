import { useState } from "react";
import {
  preStyle, thStyle, tdStyle, tableStyle, chipStyle, subPanelStyle,
} from "./Section";
import { parseStatsCsv } from "../utils/parseStatsCsv";
import { parseFailuresCsv } from "../utils/parseFailuresCsv";
import { failuresByCase, failuresByKind } from "../utils/outcomes";
import { deriveFindings } from "../utils/findings";
import Timeline from "./Timeline";
import OutcomeStrip from "./OutcomeStrip";
import Findings from "./Findings";
import SloVerdict from "./SloVerdict";
import CapacityResult from "./CapacityResult";
import { colors, font, outcome, space, radius, type } from "../theme";

function rowStats(r) {
  const requests = Number(r["Request Count"]) || 0;
  const failures = Number(r["Failure Count"]) || 0;
  return { requests, failures, rate: requests > 0 ? (failures / requests) * 100 : 0 };
}

// One key figure in the stats row: sentence-case label above, the number,
// and an optional note below. Dividers between figures come from .stat-row
// in index.css.
function KeyFigure({ label, value, note, title }) {
  return (
    <div title={title}>
      <div style={{ fontSize: type.meta, color: colors.textMuted }}>{label}</div>
      <div style={{ fontFamily: font.mono, fontSize: type.readout, lineHeight: 1.2, color: colors.text }}>{value}</div>
      {note && <div style={{ fontSize: type.meta, color: colors.textMuted }}>{note}</div>}
    </div>
  );
}

// The stats CSV only carries the case label, so the category is derived
// from the label prefixes used by the backend's edge-case generator.
const CATEGORY_ORDER = [
  "valid_input",
  "missing_field",
  "null_value",
  "type_mismatch",
  "boundary_value",
  "known_attack",
  "other",
];

export const CATEGORY_LABELS = {
  valid_input: "Valid sample",
  missing_field: "Missing field",
  null_value: "Null value",
  type_mismatch: "Type mismatch",
  boundary_value: "Boundary value",
  known_attack: "Known attack",
  other: "Other / custom",
};

function categoryOf(name) {
  if (!name) return "other";
  if (name === "valid_sample") return "valid_input";
  if (name.startsWith("missing_")) return "missing_field";
  if (name.startsWith("null_")) return "null_value";
  if (name.startsWith("wrong_type_")) return "type_mismatch";
  if (/^(empty_string_|very_long_string_|very_large_|negative_|zero_)/.test(name)) {
    return "boundary_value";
  }
  if (/^(sqli_|xss_)/.test(name)) return "known_attack";
  return "other";
}

const COLUMNS = [
  { key: "name", label: "Edge case" },
  { key: "requests", label: "Requests", numeric: true },
  { key: "failures", label: "Failures", numeric: true },
  { key: "rate", label: "Outcome / fail %" },
  { key: "avg", label: "Avg ms", numeric: true },
  { key: "p95", label: "p95 ms", numeric: true },
  { key: "min", label: "Min ms", numeric: true },
  { key: "max", label: "Max ms", numeric: true },
];

function rowValue(r, key) {
  const s = rowStats(r);
  switch (key) {
    case "name": return r.Name || "";
    case "requests": return s.requests;
    case "failures": return s.failures;
    case "rate": return s.rate;
    case "avg": return Number(r["Average Response Time"]) || 0;
    case "p95": return Number(r["95%"]) || 0;
    case "min": return Number(r["Min Response Time"]) || 0;
    case "max": return Number(r["Max Response Time"]) || 0;
    default: return 0;
  }
}

const PROBLEM_RATE_NOTE =
  "Problem rate counts only server errors (5xx), rate limiting (429) and connection failures. " +
  "Unlike the failure rate, it leaves out 4xx answers, which are correct when an API rejects invalid input.";

const HANDLED_NOTE =
  "Every case had an expected answer: 2xx for valid input, a 4xx rejection for invalid input. " +
  "A request is handled correctly when the API answered as expected; a 429, a 5xx or no answer never is.";

// The expected answer of one case, shown next to its name.
function ExpectTag({ expect }) {
  if (!expect) return null;
  const accept = expect === "accept";
  return (
    <span
      title={accept ? "Valid input: a 2xx answer is correct" : "Invalid input: a 4xx rejection is correct"}
      style={{ ...chipStyle, marginLeft: space.sm, color: accept ? colors.success : colors.textMuted }}
    >
      expects {accept ? "2xx" : "4xx"}
    </span>
  );
}

const P95_APPROX_NOTE =
  "Approximate: this run ran as several Locust processes in parallel on the same host, and " +
  "percentiles cannot be merged exactly — the value is a request-weighted average of each process's p95.";

// Locust writes "N/A" for percentiles of rows with no data.
function formatMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : "—";
}

const num = { textAlign: "right" };

export default function JobResultSummary({ data, showRaw, onToggleRaw, regressionInfo }) {
  const [sort, setSort] = useState({ key: "rate", dir: "desc" });
  const [view, setView] = useState("flat");
  const [collapsed, setCollapsed] = useState({});
  const [showFailureReasons, setShowFailureReasons] = useState(false);
  const [showRawErrors, setShowRawErrors] = useState(false);

  const rows = parseStatsCsv(data.aggregated_stats_csv || data.stats_csv);
  const nonAggregated = rows.filter((r) => r.Name && r.Name !== "Aggregated");
  const aggregated = rows.find((r) => r.Name === "Aggregated");

  // Split runs carry a child_jobs list; their percentiles are approximations.
  const isGroup = Array.isArray(data.child_jobs);
  const approx = isGroup ? "≈" : "";
  // Website runs: groups record job_type. Single jobs don't, but website rows
  // are named after page paths, which always start with "/", while edge-case
  // labels never do.
  const isWebsite =
    data.job_type === "website" ||
    (nonAggregated.length > 0 && nonAggregated.every((r) => r.Name.startsWith("/")));
  const activeView = isWebsite ? "flat" : view;
  const columns = COLUMNS.map((c) => {
    if (c.key === "name") return { ...c, label: isWebsite ? "Page" : "Edge case" };
    // With expected outcomes a "failure" is an unexpected answer.
    if (c.key === "failures" && data.outcome_summary) return { ...c, label: "Unexpected" };
    if (c.key === "rate" && data.outcome_summary) return { ...c, label: "Outcome / unexpected %" };
    // Merged p95 of a split run is approximate: say so in the header too.
    if (c.key === "p95" && isGroup) return { ...c, label: "≈ p95 ms" };
    return c;
  });
  const failureTypes = data.failure_summary || [];
  // Set when the run's cases carried expected outcomes (accept / reject).
  const outcomeSummary = data.outcome_summary || null;
  const expectations = data.case_expectations || {};
  const passedLabel = outcomeSummary ? "Handled correctly" : undefined;
  const caseOutcomes = failuresByCase(failureTypes);

  const sorted = [...nonAggregated].sort((a, b) => {
    const av = rowValue(a, sort.key);
    const bv = rowValue(b, sort.key);
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sort.dir === "asc" ? cmp : -cmp;
  });

  function toggleSort(key) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" }
    );
  }

  const agg = aggregated ? rowStats(aggregated) : null;

  // Distinct error texts with total occurrences and the edge cases that hit
  // them; empty (renders nothing) when the run produced no failures file.
  const failureRows = parseFailuresCsv(data.aggregated_failures_csv || data.failures_csv);
  const errorGroups = Object.values(
    failureRows.reduce((acc, r) => {
      const error = r.Error || "(no error text)";
      const count = Number(r.Occurrences) || 0;
      if (!acc[error]) acc[error] = { error, total: 0, cases: [] };
      acc[error].total += count;
      acc[error].cases.push({ name: r.Name, count });
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  const groups = CATEGORY_ORDER.map((cat) => {
    const catRows = sorted.filter((r) => categoryOf(r.Name) === cat);
    const requests = catRows.reduce((sum, r) => sum + rowStats(r).requests, 0);
    const failures = catRows.reduce((sum, r) => sum + rowStats(r).failures, 0);
    const kinds = {};
    catRows.forEach((r) => {
      Object.entries(caseOutcomes[r.Name] || {}).forEach(([k, v]) => (kinds[k] = (kinds[k] || 0) + v));
    });
    return {
      cat,
      rows: catRows,
      requests,
      failures,
      kinds,
      rate: requests > 0 ? (failures / requests) * 100 : 0,
    };
  }).filter((g) => g.rows.length > 0);

  const findings =
    data.status === "completed" && agg
      ? deriveFindings({
          failureSummary: failureTypes,
          caseRows: nonAggregated,
          totalRequests: agg.requests,
          totalFailures: agg.failures,
          regressionInfo,
          outcomeSummary,
        })
      : [];

  const viewToggleBtn = (mode, label) => (
    <button
      key={mode}
      onClick={() => setView(mode)}
      aria-pressed={view === mode}
      className="toggle"
    >
      {label}
    </button>
  );

  const outcomeCell = (requests, kinds, failures, rate) => (
    <td style={tdStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
        <div style={{ flex: 1 }}>
          <OutcomeStrip requests={requests} kindCounts={kinds} failureTotal={failures} passedLabel={passedLabel} />
        </div>
        <span style={{ width: 40, textAlign: "right", color: failures === 0 ? colors.success : colors.text }}>
          {rate.toFixed(0)}%
        </span>
      </div>
    </td>
  );

  const resultRow = (r, i) => {
    const s = rowStats(r);
    return (
      <tr key={r.Name || i}>
        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
          {r.Name}
          <ExpectTag expect={expectations[r.Name]} />
        </td>
        <td style={{ ...tdStyle, ...num }}>{s.requests}</td>
        <td style={{ ...tdStyle, ...num }}>{s.failures}</td>
        {outcomeCell(s.requests, caseOutcomes[r.Name], s.failures, s.rate)}
        <td style={{ ...tdStyle, ...num }}>{Math.round(Number(r["Average Response Time"]))}</td>
        <td style={{ ...tdStyle, ...num }} title={isGroup ? P95_APPROX_NOTE : undefined}>
          {approx}{formatMs(r["95%"])}
        </td>
        <td style={{ ...tdStyle, ...num }}>{Math.round(Number(r["Min Response Time"]))}</td>
        <td style={{ ...tdStyle, ...num }}>{Math.round(Number(r["Max Response Time"]))}</td>
      </tr>
    );
  };

  const runKinds = failuresByKind(failureTypes);

  return (
    <div style={{ marginTop: space.lg }}>
      {(data.status === "failed" || data.status === "timeout") && (
        <div
          role="alert"
          style={{
            background: colors.dangerSoft,
            border: `1px solid ${colors.danger}`,
            color: colors.text,
            padding: space.md,
            borderRadius: radius.md,
            fontSize: type.body,
            marginBottom: space.md,
          }}
        >
          <strong style={{ color: colors.danger }}>
            {data.status === "timeout" ? "The run timed out." : "The run failed."}
          </strong>{" "}
          {data.status === "timeout"
            ? "Locust did not finish within the run's duration plus a minute, so it was stopped."
            : !data.error && "No error message was recorded."}
          {agg ? " The figures below are whatever was recorded." : " No statistics were recorded."}
          {data.error && (
            // Locust's error output (often a traceback): keep its line breaks.
            <pre style={{ ...preStyle, maxHeight: 220, margin: `${space.sm}px 0 0`, color: colors.text }}>
              {data.error}
            </pre>
          )}
        </div>
      )}

      {data.status === "interrupted" && (
        <div
          role="alert"
          style={{
            background: colors.warningSoft,
            border: `1px solid ${colors.warning}`,
            color: colors.text,
            padding: space.md,
            borderRadius: radius.md,
            fontSize: type.body,
            marginBottom: space.md,
          }}
        >
          <strong style={{ color: colors.warning }}>Interrupted.</strong>{" "}
          {data.error || "The backend stopped while this run was in progress, so it never finished."}
          {agg ? " The figures below are whatever was recorded before that." : " No results were recorded."}
        </div>
      )}

      {data.status === "cancelled" && (
        <p role="status" style={{ margin: `0 0 ${space.md}px`, fontSize: type.body, color: colors.warning }}>
          {agg
            ? "Cancelled — partial results. The figures below cover only the part of the test that ran."
            : "Cancelled — no results were recorded before the test was stopped."}
        </p>
      )}

      <SloVerdict verdict={data.slo_verdict} approximate={isGroup} />
      {data.mode === "capacity" && (
        <CapacityResult capacity={data.capacity} plan={data.capacity_plan} slo={data.slo} />
      )}

      <Findings findings={findings} />

      {agg && (
        <>
          <div className="stat-row">
            <KeyFigure label="Requests" value={agg.requests.toLocaleString()} />
            {outcomeSummary ? (
              <KeyFigure
                label="Handled correctly"
                value={`${outcomeSummary.handled_correctly_pct.toFixed(1)}%`}
                note={`${outcomeSummary.handled_correctly.toLocaleString()} of ${agg.requests.toLocaleString()} as expected`}
                title={HANDLED_NOTE}
              />
            ) : (
              <KeyFigure
                label="Failure rate"
                value={`${agg.rate.toFixed(1)}%`}
                note={`${agg.failures.toLocaleString()} of ${agg.requests.toLocaleString()}`}
              />
            )}
            {data.problem_rate != null && (
              <KeyFigure
                label="Problem rate"
                value={`${data.problem_rate.toFixed(1)}%`}
                note="5xx, 429 and connection failures"
                title={PROBLEM_RATE_NOTE}
              />
            )}
            <KeyFigure label="Avg response" value={`${Math.round(Number(aggregated["Average Response Time"]))} ms`} />
            <KeyFigure
              label="p95 response"
              value={`${approx}${formatMs(aggregated["95%"])} ms`}
              note={isGroup ? "approximate (split run)" : "95% were faster"}
              title={isGroup ? P95_APPROX_NOTE : "95% of requests finished within this time."}
            />
            <KeyFigure label="Requests / s" value={Number(aggregated["Requests/s"]).toFixed(2)} />
            <KeyFigure
              label="Duration"
              value={data.duration_seconds != null ? `${data.duration_seconds} s` : "—"}
            />
          </div>

          <div style={{ ...subPanelStyle, padding: space.md, marginTop: space.sm }}>
            <div style={{ fontFamily: font.mono, fontSize: type.meta, color: colors.textMuted, marginBottom: space.sm }}>
              How the {agg.requests.toLocaleString()} requests ended
            </div>
            <OutcomeStrip
              requests={agg.requests}
              kindCounts={runKinds}
              failureTotal={agg.failures}
              size="large"
              passedLabel={passedLabel}
            />
            {outcomeSummary && (
              <p style={{ margin: `${space.sm}px 0 0`, fontSize: type.meta, color: colors.textMuted, maxWidth: "80ch" }}>
                {HANDLED_NOTE} "Accepted invalid input" usually means missing validation; if the field is
                optional, set that case to expect 2xx before the next run.
              </p>
            )}
          </div>
        </>
      )}

      {!agg && data.status === "completed" && (
        <p style={{ color: colors.textMuted, fontSize: type.body }}>
          The run finished but produced no statistics. Check that the target was reachable and try again.
        </p>
      )}

      {nonAggregated.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", marginTop: space.xl, marginBottom: space.xs }}>
          <h3 style={{ margin: 0, fontSize: type.body, fontWeight: 600, flex: 1 }}>
            {isWebsite ? "Pages" : "Edge cases"}
            <span style={{ fontFamily: font.mono, fontWeight: 400, color: colors.textMuted, marginLeft: space.sm, fontSize: type.meta }}>
              {nonAggregated.length}
            </span>
          </h3>
          {!isWebsite && (
            <div role="group" aria-label="Table view" style={{ display: "flex", gap: space.xs }}>
              {viewToggleBtn("flat", "Flat")}
              {viewToggleBtn("grouped", "Grouped")}
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={{ ...thStyle, ...(c.numeric ? num : {}) }}
                    aria-sort={sort.key === c.key ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
                  >
                    <button
                      onClick={() => toggleSort(c.key)}
                      title={`Sort by ${c.label}`}
                      className="btn-bare"
                      style={{ color: sort.key === c.key ? colors.text : undefined }}
                    >
                      {c.label}
                      <span style={{ color: colors.accent, marginLeft: space.xs, fontSize: type.meta }}>
                        {sort.key === c.key ? (sort.dir === "desc" ? "▾" : "▴") : ""}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeView === "flat" && sorted.map(resultRow)}
              {activeView === "grouped" &&
                groups.map((g) => {
                  const isOpen = !collapsed[g.cat];
                  return [
                    <tr key={`hdr-${g.cat}`} style={{ background: colors.surfaceRaised }}>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => setCollapsed((prev) => ({ ...prev, [g.cat]: !prev[g.cat] }))}
                          aria-expanded={isOpen}
                          className="btn-bare"
                          style={{ color: colors.text, fontFamily: font.sans, fontSize: type.body, fontWeight: 600 }}
                        >
                          <span style={{ color: colors.accent, marginRight: space.sm, fontSize: type.meta }}>
                            {isOpen ? "▾" : "▸"}
                          </span>
                          {CATEGORY_LABELS[g.cat]}
                          <span style={{ color: colors.textMuted, fontWeight: 400, marginLeft: space.sm, fontFamily: font.mono, fontSize: type.meta }}>
                            {g.rows.length}
                          </span>
                        </button>
                      </td>
                      <td style={{ ...tdStyle, ...num }}>{g.requests}</td>
                      <td style={{ ...tdStyle, ...num }}>{g.failures}</td>
                      {outcomeCell(g.requests, g.kinds, g.failures, g.rate)}
                      <td style={tdStyle} colSpan={4} />
                    </tr>,
                    ...(isOpen ? g.rows.map(resultRow) : []),
                  ];
                })}
              {aggregated && agg && (
                <tr style={{ fontWeight: 600 }}>
                  <td style={{ ...tdStyle, borderTop: `1px solid ${colors.border}` }}>Total</td>
                  <td style={{ ...tdStyle, ...num }}>{agg.requests}</td>
                  <td style={{ ...tdStyle, ...num }}>{agg.failures}</td>
                  {outcomeCell(agg.requests, runKinds, agg.failures, agg.rate)}
                  <td style={{ ...tdStyle, ...num }}>{Math.round(Number(aggregated["Average Response Time"]))}</td>
                  <td style={{ ...tdStyle, ...num }} title={isGroup ? P95_APPROX_NOTE : undefined}>
                    {approx}{formatMs(aggregated["95%"])}
                  </td>
                  <td style={{ ...tdStyle, ...num }}>{Math.round(Number(aggregated["Min Response Time"]))}</td>
                  <td style={{ ...tdStyle, ...num }}>{Math.round(Number(aggregated["Max Response Time"]))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Timeline historyCsv={data.aggregated_history_csv || data.history_csv} approximate={isGroup} />

      {(failureTypes.length > 0 || errorGroups.length > 0) && (
        <div style={{ ...subPanelStyle, marginTop: space.md }}>
          <button
            onClick={() => setShowFailureReasons((v) => !v)}
            aria-expanded={showFailureReasons}
            className="btn-bare"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: space.sm,
              padding: `${space.sm}px ${space.md}px`,
              color: colors.text,
              fontSize: type.body,
              fontWeight: 600,
            }}
          >
            <span style={{ color: colors.accent, fontSize: type.meta }}>
              {showFailureReasons ? "▾" : "▸"}
            </span>
            Why did these fail?
            <span style={{ color: colors.textMuted, fontWeight: 400, fontFamily: font.mono, fontSize: type.meta }}>
              {failureTypes.length} failure type{failureTypes.length === 1 ? "" : "s"}
            </span>
          </button>

          {showFailureReasons && (
            <div style={{ padding: `0 ${space.md}px ${space.md}px` }}>
              {failureTypes.map((t) => {
                const tone = outcome[t.kind] || outcome.other;
                return (
                  <div
                    key={String(t.code)}
                    style={{ borderTop: `1px solid ${colors.borderSubtle}`, padding: `${space.sm}px 0` }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
                      <span
                        style={{
                          fontFamily: font.mono,
                          fontSize: type.meta,
                          fontWeight: 500,
                          color: tone.fg,
                          background: tone.soft,
                          border: `1px solid ${tone.fg}`,
                          borderRadius: radius.sm,
                          padding: `0 ${space.sm}px`, lineHeight: "20px",
                        }}
                      >
                        {t.code ?? "ERR"}
                      </span>
                      <span style={{ flex: 1, fontSize: type.body, color: colors.text }}>
                        {t.meaning}
                        <span style={{ color: colors.textMuted, fontFamily: font.mono, fontSize: type.meta, marginLeft: space.sm }}>
                          {t.reason}
                        </span>
                      </span>
                      <span style={{ fontFamily: font.mono, fontSize: type.meta, color: colors.textMuted, whiteSpace: "nowrap" }}>
                        ×{t.total}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: space.xs, marginTop: space.xs }}>
                      {t.cases.map((c) => (
                        <span key={c.case} style={chipStyle}>
                          {c.case} ×{c.occurrences}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}

              {errorGroups.length > 0 && (
                <button onClick={() => setShowRawErrors((v) => !v)} aria-expanded={showRawErrors} className="btn-link">
                  {showRawErrors ? "Hide raw errors" : `Show raw errors (${errorGroups.length})`}
                </button>
              )}

              {showRawErrors && errorGroups.map((g) => (
                <div key={g.error} style={{ borderTop: `1px solid ${colors.borderSubtle}`, padding: `${space.sm}px 0` }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: space.sm }}>
                    <span style={{ fontFamily: font.mono, fontSize: type.meta, color: colors.text, wordBreak: "break-word", flex: 1 }}>
                      {g.error}
                    </span>
                    <span style={{ fontFamily: font.mono, fontSize: type.meta, color: colors.textMuted, whiteSpace: "nowrap" }}>
                      ×{g.total}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: space.xs, marginTop: space.xs }}>
                    {g.cases.map((c) => (
                      <span key={c.name} style={chipStyle}>
                        {c.name} ×{c.count}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button onClick={onToggleRaw} aria-expanded={showRaw} className="btn-link" style={{ marginTop: space.sm }}>
        {showRaw ? "Hide raw response" : "Show raw response"}
      </button>

      {showRaw && <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
