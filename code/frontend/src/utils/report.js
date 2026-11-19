import { parseStatsCsv } from "./parseStatsCsv";
import { formatTime } from "./formatTime";
import { runReport, formatPct, payloadText, SLO_LABELS } from "./runReport";

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

export function buildMarkdownReport(run, regressionInfo, config = null) {
  const rep = runReport(run, config);
  const rows = parseStatsCsv(run.aggregated_stats_csv || run.stats_csv);
  const total = rows.find((r) => r.Name === "Aggregated");
  const isGroup = Array.isArray(run.child_jobs);
  const id = run.job_id || run.group_id;
  const approx = isGroup ? "≈" : "";

  const lines = [
    "# Load test report — Elevate Load Tester",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "## Target",
    "",
    `- URL: ${config?.url || run.target_url}`,
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
    lines.push("## Findings", "");
    if (rep.bugs.length) {
      lines.push(`**${rep.bugCaseCount} case${rep.bugCaseCount === 1 ? "" : "s"} found bugs.**`, "");
      rep.bugs.forEach((b) => {
        const title = { accepted_invalid_input: "Accepted invalid input", rejected_valid_input: "Rejected valid input", server_error: "Server error" }[b.kind];
        lines.push(`- ${title}${b.codes.length ? ` (${b.codes.join(", ")})` : ""}: ${b.total} requests`);
        b.cases.forEach((c) => {
          const p = payloadText(c.payload);
          lines.push(`  - \`${c.name}\` ×${c.count}${p ? ` — payload \`${p.length > 200 ? `${p.slice(0, 200)}…` : p}\`` : ""}`);
        });
      });
      lines.push("");
    } else {
      lines.push(rep.untested.length ? `No bugs found in the ${rep.tested.length} cases that were tested.` : "No bugs found.", "");
    }
    lines.push(
      rep.untested.length
        ? `Coverage: ${rep.tested.length} of ${rep.cases.length} cases tested. Not tested (no requests): ${rep.untested.map((c) => c.name).join(", ")}.`
        : `Coverage: all ${rep.cases.length} cases got requests.`,
      "",
    );
    rep.loadEffects.forEach((g) => {
      lines.push(`${g.kind === "rate_limited" ? "Rate limited (429)" : "No answer (connection failure)"}: ${g.total} requests (load effect, not an input bug).`, "");
    });
    lines.push(
      "## Summary",
      "",
      table(
        ["Metric", "Value"],
        [
          ["Total requests", rep.requests],
          [rep.hasExpectations ? "Unexpected answers" : "Failed requests", `${formatPct(rep.unexpectedPct)} (${rep.unexpected} of ${rep.requests})`],
          ["Average response", `${num(total["Average Response Time"])} ms`],
          ["p95 response", `${approx}${num(total["95%"])} ms`],
          ["Requests per second", num(total["Requests/s"], 2)],
        ]
      ),
      "",
    );
    lines.push(
      rep.hasExpectations
        ? "An answer is unexpected when it is not what a correct API gives: 2xx for valid input, a 4xx rejection for invalid input. 429, 5xx and no answer are always unexpected."
        : "This run had no expected outcomes, so every non-2xx answer counts as failed.",
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
          SLO_LABELS[c.key] || c.label,
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
      "Every case had an expected answer. A request is unexpected when the answer did not match.",
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

  if (rep.cases.length > 0) {
    const sorted = [...rep.cases].sort((a, b) => (a.tested !== b.tested ? (a.tested ? -1 : 1) : (b.unexpectedPct ?? 0) - (a.unexpectedPct ?? 0)));
    lines.push(
      "## Per-case results",
      "",
      table(
        ["Case", "Expects", "Requests", rep.hasExpectations ? "Unexpected" : "Failed", "Share", "Avg ms", "p95 ms"],
        sorted.map((c) => [
          c.name,
          { accept: "2xx", reject: "4xx" }[c.expect] || "—",
          c.requests,
          c.tested ? c.unexpected : "not tested",
          c.tested ? formatPct(c.unexpectedPct) : "—",
          num(c.avg),
          c.p95 == null ? "—" : `${approx}${num(c.p95)}`,
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
      lines.push(`No case's unexpected share rose by ${regressionInfo.threshold}+ points.`, "");
    } else {
      lines.push(
        table(
          ["Case", "Baseline unexpected %", "This run unexpected %", "Increase (points)"],
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
