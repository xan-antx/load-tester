// The one place that turns a run's status response into what the results
// screen, Compare and the Markdown report say. Pure functions, no React.
//
// Definitions (see docs/ux-revamp-plan.md):
// - An answer is UNEXPECTED when it differs from what a correct API gives:
//   2xx for valid input, a 4xx rejection for invalid input; a 429, a 5xx or
//   no answer is never correct. unexpected = requests - handled correctly.
//   Runs without expected outcomes (older runs, websites) fall back to
//   Locust's failure count, and `hasExpectations` is false.
// - BUGS are the unexpected answers that show a defect in the target:
//   accepted invalid input, rejected valid input, server errors (5xx).
//   Rate limiting and connection failures are load effects, not bugs.
// - A case is UNTESTED when it was sent with the run but got no requests
//   (Locust drops it from the stats entirely).

import { parseStatsCsv } from "./parseStatsCsv";
import { failuresByCase, failuresByKind } from "./outcomes";

export const BUG_KINDS = ["accepted_invalid_input", "rejected_valid_input", "server_error"];
export const LOAD_KINDS = ["rate_limited", "connection"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// One rounding rule for percentages everywhere: one decimal, except 0 and 100.
export function pct(part, whole) {
  if (!whole) return null;
  return (part / whole) * 100;
}
export function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0 || value === 100) return `${value}%`;
  if (value > 0 && value < 0.1) return "<0.1%";
  if (value > 99.9 && value < 100) return ">99.9%";
  return `${value.toFixed(1)}%`;
}
export function formatMs(value) {
  const n = num(value);
  return n == null ? "—" : Math.round(n).toLocaleString();
}

// The stats CSV only carries the case label, so the category is derived from
// the label prefixes used by the backend's edge-case generator.
export const CATEGORY_ORDER = [
  "valid_input", "missing_field", "null_value", "type_mismatch", "boundary_value", "known_attack", "custom", "other",
];
export const CATEGORY_LABELS = {
  valid_input: "Valid sample",
  missing_field: "Missing field",
  null_value: "Null value",
  type_mismatch: "Type mismatch",
  boundary_value: "Boundary value",
  known_attack: "Injection",
  custom: "Your own cases",
  other: "Other",
};
export function categoryOf(name) {
  if (!name) return "other";
  if (name === "valid_sample") return "valid_input";
  if (name.startsWith("missing_")) return "missing_field";
  if (name.startsWith("null_")) return "null_value";
  if (name.startsWith("wrong_type_")) return "type_mismatch";
  if (/^(empty_string_|very_long_string_|very_large_|negative_|zero_)/.test(name)) return "boundary_value";
  if (/^(sqli_|xss_)/.test(name)) return "known_attack";
  return "other";
}

// config: the run configuration this browser stored when it started the run
// (utils/runStore.js), or null. It supplies payloads and the full URL.
export function runReport(data, config = null) {
  const rows = parseStatsCsv(data?.aggregated_stats_csv || data?.stats_csv);
  const aggregated = rows.find((r) => r.Name === "Aggregated") || null;
  const statRows = rows.filter((r) => r.Name && r.Name !== "Aggregated");
  const failureSummary = data?.failure_summary || [];
  const outcomeSummary = data?.outcome_summary || null;
  const expectations = data?.case_expectations || {};
  const hasExpectations = !!outcomeSummary;
  const isGroup = Array.isArray(data?.child_jobs);
  const isWebsite =
    data?.job_type === "website" ||
    (statRows.length > 0 && statRows.every((r) => r.Name.startsWith("/")));

  const configCases = Object.fromEntries((config?.cases || []).map((c) => [c.label, c]));
  const byCase = failuresByCase(failureSummary);
  const kinds = failuresByKind(failureSummary);

  const requests = aggregated ? num(aggregated["Request Count"]) || 0 : 0;
  const failures = aggregated ? num(aggregated["Failure Count"]) || 0 : 0;
  const unexpected = hasExpectations
    ? Math.max(requests - (outcomeSummary.handled_correctly || 0), 0)
    : failures;
  const expected = Math.max(requests - unexpected, 0);

  // Every case the run was meant to send: the expectation keys (the backend
  // records every confirmed case), the locally stored config, and any row.
  const statByName = Object.fromEntries(statRows.map((r) => [r.Name, r]));
  const names = [
    ...new Set([...Object.keys(expectations), ...Object.keys(configCases), ...statRows.map((r) => r.Name)]),
  ];
  const cases = names.map((name) => {
    const r = statByName[name];
    const reqs = r ? num(r["Request Count"]) || 0 : 0;
    const unexp = r ? num(r["Failure Count"]) || 0 : 0;
    const local = configCases[name];
    return {
      name,
      category: local?.isCustom ? "custom" : categoryOf(name),
      description: local?.description || null,
      payload: local ? local.payload : undefined,
      expect: expectations[name] || local?.expect || null,
      requests: reqs,
      unexpected: unexp,
      unexpectedPct: reqs > 0 ? pct(unexp, reqs) : null,
      kinds: byCase[name] || {},
      tested: reqs > 0,
      avg: r ? num(r["Average Response Time"]) : null,
      p95: r ? num(r["95%"]) : null,
      min: r ? num(r["Min Response Time"]) : null,
      max: r ? num(r["Max Response Time"]) : null,
    };
  });
  const caseByName = Object.fromEntries(cases.map((c) => [c.name, c]));
  const untested = cases.filter((c) => !c.tested);

  // Bugs and load effects, each with the cases (and payloads) behind them.
  const groupFor = (kind) => {
    const groups = failureSummary.filter((g) => g.kind === kind);
    if (!groups.length) return null;
    const perCase = {};
    for (const g of groups) {
      for (const c of g.cases || []) {
        const entry = (perCase[c.case] = perCase[c.case] || { name: c.case, count: 0, codes: new Set() });
        entry.count += Number(c.occurrences) || 0;
        if (g.code != null) entry.codes.add(g.code);
      }
    }
    const list = Object.values(perCase)
      .map((c) => ({ ...c, codes: [...c.codes], payload: caseByName[c.name]?.payload, expect: caseByName[c.name]?.expect }))
      .sort((a, b) => b.count - a.count);
    return {
      kind,
      codes: [...new Set(groups.map((g) => g.code).filter((c) => c != null))],
      total: groups.reduce((s, g) => s + (Number(g.total) || 0), 0),
      meaning: groups[0].meaning,
      reason: groups[0].reason,
      cases: list,
    };
  };
  const bugs = BUG_KINDS.map(groupFor).filter(Boolean);
  const loadEffects = LOAD_KINDS.map(groupFor).filter(Boolean);
  const otherUnexpected = ["rejected", "other"].map(groupFor).filter(Boolean);
  const bugCaseCount = new Set(bugs.flatMap((b) => b.cases.map((c) => c.name))).size;

  // Severity of the whole run: "bugs" > "incomplete" > "clean". Untested
  // cases, load effects or any unexpected answer keep it off "clean".
  let severity = "clean";
  if (bugs.length) severity = "bugs";
  else if (untested.length || unexpected > 0 || !requests) severity = "incomplete";

  return {
    requests,
    expected,
    unexpected,
    unexpectedPct: pct(unexpected, requests),
    kinds,
    hasExpectations,
    isGroup,
    isWebsite,
    aggregated,
    avg: aggregated ? num(aggregated["Average Response Time"]) : null,
    p95: aggregated ? num(aggregated["95%"]) : null,
    min: aggregated ? num(aggregated["Min Response Time"]) : null,
    max: aggregated ? num(aggregated["Max Response Time"]) : null,
    rps: aggregated ? num(aggregated["Requests/s"]) : null,
    cases,
    tested: cases.filter((c) => c.tested),
    untested,
    bugs,
    bugCaseCount,
    loadEffects,
    otherUnexpected,
    severity,
  };
}

// Frontend names for the backend's SLO threshold keys (analysis/slo.py). The
// backend's "unexpected outcome" threshold counts only answers that are wrong
// for the input (accepted invalid + rejected valid), so it gets a name that
// cannot be confused with the app-wide "unexpected answers" figure.
export const SLO_LABELS = {
  p95_ms: "p95 response time",
  avg_ms: "Average response time",
  max_server_error_rate_pct: "Server errors (5xx or no answer)",
  max_unexpected_outcome_rate_pct: "Wrong answers to the input",
  min_rps: "Throughput",
};

// Compact one-line JSON for a payload, for tables and findings.
export function payloadText(payload) {
  if (payload === undefined) return null;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}
