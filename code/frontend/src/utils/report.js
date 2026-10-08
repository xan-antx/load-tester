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
    `- Status: ${run.status}`,
    "",
    "## Configuration",
    "",
    `- Users: ${run.users}`,
    `- Spawn rate: ${run.spawn_rate} users/s`,
    `- Duration: ${run.duration_seconds} s`,
    `- Workers: ${isGroup ? `${run.child_jobs.length} (split run)` : "1"}`,
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
          ["Average response", `${num(total["Average Response Time"])} ms`],
          ["p95 response", `${approx}${num(total["95%"])} ms`],
          ["Requests per second", num(total["Requests/s"], 2)],
        ]
      ),
      "",
    );
    if (isGroup) {
      lines.push("≈ p95 for split runs is approximate (a weighted average of each worker's p95).", "");
    }
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
        ["Case", "Requests", "Failures", "Fail %", "Avg ms", "p95 ms"],
        sorted.map((r) => [
          r.Name,
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
