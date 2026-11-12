import { parseStatsCsv } from "./parseStatsCsv";
import { formatTime } from "./formatTime";

// Builds a Markdown report for one completed run, entirely in the browser.
// regressionInfo is the /api/regressions response (may be null).

const md = (value) => String(value ?? "—").replace(/\|/g, "\\|");

function num(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(md).join(" | ")} |`),
  ].join("\n");
}

// Plain-English meaning of each outcome category (runs with expectations).
const OUTCOME_EXPLANATIONS = [
  ["handled_correctly", "Handled correctly", "the answer matched the expectation: 2xx for valid input, a 4xx rejection for invalid input"],
  ["accepted_invalid_input", "Accepted invalid input", "2xx for a request that should have been rejected: a validation bug (or an optional field)"],
  ["rejected_valid_input", "Rejected valid input", "4xx for a request that should have succeeded"],
  ["server_error", "Server error", "5xx: the server failed, whatever was expected"],
  ["rate_limited", "Rate limited", "429: refused because of load"],
  ["connection", "Connection failure", "no HTTP answer at all"],
];

export function buildMarkdownReport(run, regressionInfo) {
  const rows = parseStatsCsv(run.aggregated_stats_csv || run.stats_csv);
  const cases = rows.filter((r) => r.Name && r.Name !== "Aggregated");
  const total = rows.find((r) => r.Name === "Aggregated");
  const isGroup = Array.isArray(run.child_jobs);
  const id = run.job_id || run.group_id;
  const approx = isGroup ? "≈" : "";
  const rate = (r) =>
    Number(r["Request Count"]) > 0
      ? (Number(r["Failure Count"]) / Number(r["Request Count"])) * 100
      : 0;

  const lines = [
    "# Load test report — Elevate Load Tester",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "## Target",
    "",
    `- URL: ${run.target_url}`,
    `- Run id: ${id}`,
    `- Started: ${formatTime(run.created_at)}`,
    `- Status: ${run.status === "cancelled" ? "cancelled — partial results" : run.status}`,
    "",
    "## Configuration",
    "",
    `- Users: ${run.users}`,
    `- Spawn rate: ${run.spawn_rate} users/s`,
    `- Duration: ${run.duration_seconds} s`,
    `- Locust processes: ${isGroup ? `${run.child_jobs.length}, in parallel on the same host (split run)` : "1"}`,
    // Header names only; the values are never available to the browser report.
    `- Request headers: ${run.header_names?.length ? `${run.header_names.join(", ")} (values not included)` : "none"}`,
    "",
  ];

  if (total) {
    lines.push(
      "## Summary",
      "",
      table(
        ["Metric", "Value"],
        [
          ["Total requests", total["Request Count"]],
          ["Failures", total["Failure Count"]],
          ["Failure rate", `${num(rate(total), 1)}%`],
          ["Problem rate (5xx, 429, connection)", run.problem_rate == null ? "—" : `${num(run.problem_rate, 1)}%`],
          ...(run.outcome_summary
            ? [
                ["Handled correctly", `${num(run.outcome_summary.handled_correctly_pct, 1)}%`],
                ["Unexpected answers (accepted invalid + rejected valid)", `${num(run.outcome_summary.unexpected_outcome_rate_pct, 1)}%`],
              ]
            : []),
          ["Average response", `${num(total["Average Response Time"])} ms`],
          ["p95 response", `${approx}${num(total["95%"])} ms`],
          ["Requests per second", num(total["Requests/s"], 2)],
        ]
      ),
      "",
    );
    lines.push(
      "Failure rate counts every non-2xx answer, including 4xx rejections of invalid input. " +
        "Problem rate counts only server errors, rate limiting and connection failures.",
      "",
    );
    if (isGroup) {
      lines.push("≈ p95 for split runs is approximate: a request-weighted average of each Locust process's p95, not a true percentile of all requests.", "");
    }
  }

  const capacity = run.capacity;
  if (capacity) {
    const plan = run.capacity_plan || {};
    lines.push(
      "## Capacity",
      "",
      `**${capacity.headline}.**`,
      "",
      capacity.breaking_point_users != null
        ? `Breaking point: ${capacity.breaking_point_users} users (${capacity.breaking_reason}).`
        : `No breaking point within ${capacity.tested_up_to_users ?? "—"} users.`,
      "",
      `Steps of ${plan.step_users} users every ${plan.step_duration_seconds} s, from ${plan.start_users} to ${plan.max_users} users; judged on ${capacity.criteria}.${capacity.stopped_early ? " Stopped after the first failing step." : ""}`,
      "",
      table(
        ["Users", "Req/s", "p95 ms", "Avg ms", "Server errors %", "Unexpected %", "429 %", "Verdict"],
        capacity.steps.map((s) => [
          s.planned_users,
          num(s.rps, 1),
          num(s.p95_ms),
          num(s.avg_ms),
          s.server_error_rate_pct == null ? "—" : num(s.server_error_rate_pct, 1),
          s.unexpected_outcome_rate_pct == null ? "—" : num(s.unexpected_outcome_rate_pct, 1),
          s.rate_limited_pct == null ? "—" : num(s.rate_limited_pct, 1),
          s.complete ? s.verdict || "—" : "partial",
        ])
      ),
      "",
    );
  }

  const verdict = run.slo_verdict;
  if (verdict) {
    lines.push(
      `## SLO verdict: ${verdict.verdict || "not measured"}`,
      "",
      table(
        ["Threshold", "Target", "Actual", "Result"],
        verdict.checks.map((c) => [
          c.label,
          `${c.comparison === "<=" ? "≤" : "≥"} ${c.target} ${c.unit}`,
          c.actual == null ? "—" : `${c.key === "p95_ms" ? approx : ""}${c.actual} ${c.unit}`,
          c.passed === true ? "met" : c.passed === false ? "MISSED" : "not measured",
        ])
      ),
      "",
    );
  }

  const outcomes = run.outcome_summary;
  if (outcomes) {
    lines.push(
      "## Expected vs actual outcomes",
      "",
      "Every case had an expected answer. A request counts as a failure only when the answer did not match.",
      "",
      table(
        ["Outcome", "Requests", "Meaning"],
        OUTCOME_EXPLANATIONS.map(([key, label, meaning]) => [label, outcomes[key] ?? 0, meaning])
      ),
      "",
    );
  }

  const failureTypes = run.failure_summary || [];
  if (failureTypes.length > 0) {
    lines.push(
      "## Failure types",
      "",
      table(
        ["Status", "Meaning", "Total", "Cases (most frequent first)"],
        failureTypes.map((t) => [
          t.code ?? "no code",
          t.meaning,
          t.total,
          t.cases.map((c) => `${c.case} ×${c.occurrences}`).join(", "),
        ])
      ),
      "",
    );
  }

  if (cases.length > 0) {
    const sorted = [...cases].sort((a, b) => rate(b) - rate(a));
    lines.push(
      "## Per-case results",
      "",
      table(
        ["Case", "Expects", "Requests", "Failures", "Fail %", "Avg ms", "p95 ms"],
        sorted.map((r) => [
          r.Name,
          { accept: "2xx", reject: "4xx" }[(run.case_expectations || {})[r.Name]] || "—",
          r["Request Count"],
          r["Failure Count"],
          num(rate(r), 1),
          num(r["Average Response Time"]),
          `${approx}${num(r["95%"])}`,
        ])
      ),
      "",
    );
  }

  if (regressionInfo?.baseline) {
    const b = regressionInfo.baseline;
    lines.push(
      "## Compared with baseline",
      "",
      `Baseline: ${b.users} users, ${formatTime(b.created_at)} (run ${b.id}).`,
      "",
      `p95 change: ${regressionInfo.p95_change_pct == null ? "unknown" : `${regressionInfo.p95_change_pct}%`}`,
      "",
    );
    if (regressionInfo.regressions.length === 0) {
      lines.push(`No case's failure rate rose by ${regressionInfo.threshold}+ points.`, "");
    } else {
      lines.push(
        table(
          ["Case", "Baseline fail %", "This run fail %", "Increase (points)"],
          regressionInfo.regressions.map((r) => [r.case, r.baseline_rate, r.current_rate, r.increase])
        ),
        "",
      );
    }
  } else if (regressionInfo?.is_current_baseline) {
    lines.push("## Baseline", "", "This run is the baseline for its target.", "");
  }

  return lines.join("\n");
}

export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
