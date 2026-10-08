// Plain-language "Findings" for a completed run, built only from data the
// backend already returned: failure_summary, the per-case stats rows, and
// the baseline comparison (/api/regressions). Pure function.
//
// Each finding: { tone, text } where tone is an outcome key from theme.js
// (passed / rejected / rate_limited / server_error / connection) or "worse".

const n = (x) => Number(x).toLocaleString();
const plural = (count, word) => `${n(count)} ${word}${count === 1 ? "" : "s"}`;

function codesOf(groups) {
  const codes = [...new Set(groups.map((g) => g.code).filter((c) => c != null))];
  return codes.length ? codes.join(", ") : "";
}

export function deriveFindings({ failureSummary, caseRows, totalRequests, totalFailures, regressionInfo }) {
  const groups = failureSummary || [];
  const ofKind = (kind) => groups.filter((g) => g.kind === kind);
  const casesIn = (gs) => new Set(gs.flatMap((g) => g.cases.map((c) => c.case))).size;
  const sum = (gs) => gs.reduce((s, g) => s + (Number(g.total) || 0), 0);
  const findings = [];

  const server = ofKind("server_error");
  if (server.length) {
    findings.push({
      tone: "server_error",
      text: `${plural(casesIn(server), "case")} caused server errors (${codesOf(server)}) on ${plural(sum(server), "request")}`,
    });
  }

  if (regressionInfo?.baseline) {
    const count = regressionInfo.regressions?.length || 0;
    findings.push(
      count > 0
        ? { tone: "worse", text: `${plural(count, "case")} got worse than the baseline run` }
        : { tone: "passed", text: "No case got worse than the baseline run" }
    );
  }

  const limited = ofKind("rate_limited");
  if (limited.length) {
    findings.push({
      tone: "rate_limited",
      text: `Rate limiting (429) on ${plural(sum(limited), "request")} across ${plural(casesIn(limited), "case")}`,
    });
  }

  const rejected = ofKind("rejected");
  if (rejected.length) {
    const count = casesIn(rejected);
    findings.push({
      tone: "rejected",
      text: `${plural(count, "case")} ${count === 1 ? "was" : "were"} rejected as invalid input (${codesOf(rejected)})`,
    });
  }

  const connection = ofKind("connection");
  if (connection.length) {
    findings.push({
      tone: "connection",
      text: `${plural(sum(connection), "request")} got no response (connection failure)`,
    });
  }

  if (totalRequests > 0 && totalFailures === 0) {
    findings.unshift({ tone: "passed", text: `All ${plural(totalRequests, "request")} succeeded` });
  } else {
    const clean = (caseRows || []).filter((r) => Number(r["Failure Count"]) === 0 && Number(r["Request Count"]) > 0);
    if (clean.length) {
      findings.push({ tone: "passed", text: `${plural(clean.length, "case")} passed every request` });
    }
  }

  return findings.slice(0, 4);
}
