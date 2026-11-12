// Plain-language "Findings" for a completed run, built only from data the
// backend already returned: failure_summary, the per-case stats rows, and
// the baseline comparison (/api/regressions). Pure function.
//
// Each finding: { tone, text } where tone is an outcome key from theme.js
// (passed / rejected / rate_limited / server_error / connection /
// accepted_invalid_input / rejected_valid_input) or "worse".
//
// outcomeSummary is set for runs whose cases carry an expected outcome
// ("accept" / "reject"): there a correct 4xx counts as handled correctly.

const n = (x) => Number(x).toLocaleString();
const plural = (count, word) => `${n(count)} ${word}${count === 1 ? "" : "s"}`;

function codesOf(groups) {
  const codes = [...new Set(groups.map((g) => g.code).filter((c) => c != null))];
  return codes.length ? codes.join(", ") : "";
}

export function deriveFindings({ failureSummary, caseRows, totalRequests, totalFailures, regressionInfo, outcomeSummary }) {
  const groups = failureSummary || [];
  const ofKind = (kind) => groups.filter((g) => g.kind === kind);
  const casesIn = (gs) => new Set(gs.flatMap((g) => g.cases.map((c) => c.case))).size;
  const sum = (gs) => gs.reduce((s, g) => s + (Number(g.total) || 0), 0);
  const findings = [];

  // Answers that contradict the expectation: the most useful findings.
  const acceptedInvalid = ofKind("accepted_invalid_input");
  if (acceptedInvalid.length) {
    const count = casesIn(acceptedInvalid);
    findings.push({
      tone: "accepted_invalid_input",
      text: `${plural(count, "case")} ${count === 1 ? "was" : "were"} accepted although the input is invalid (2xx): possible validation bugs`,
    });
  }
  const rejectedValid = ofKind("rejected_valid_input");
  if (rejectedValid.length) {
    findings.push({
      tone: "rejected_valid_input",
      text: `${plural(sum(rejectedValid), "valid request")} ${sum(rejectedValid) === 1 ? "was" : "were"} rejected (${codesOf(rejectedValid)})`,
    });
  }

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

  // 401 / 403 mean "not authorised", not "invalid input".
  const isAuth = (g) => g.code === 401 || g.code === 403;
  const unauthorised = ofKind("rejected").filter(isAuth);
  if (unauthorised.length) {
    findings.push({
      tone: "rejected",
      text: `${plural(sum(unauthorised), "request")} ${sum(unauthorised) === 1 ? "was" : "were"} refused as not authorised (${codesOf(unauthorised)}); check the request headers`,
    });
  }

  const rejected = ofKind("rejected").filter((g) => !isAuth(g));
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

  if (outcomeSummary) {
    // The headline for runs with expected outcomes, so it is never cut off.
    findings.unshift({
      tone: "passed",
      text: `${outcomeSummary.handled_correctly_pct}% of requests got the expected answer (${n(outcomeSummary.handled_correctly)} of ${n(outcomeSummary.total_requests)})`,
    });
  } else if (totalRequests > 0 && totalFailures === 0) {
    findings.unshift({ tone: "passed", text: `All ${plural(totalRequests, "request")} succeeded` });
  } else {
    const clean = (caseRows || []).filter((r) => Number(r["Failure Count"]) === 0 && Number(r["Request Count"]) > 0);
    if (clean.length) {
      findings.push({ tone: "passed", text: `${plural(clean.length, "case")} passed every request` });
    }
  }

  return findings.slice(0, 4);
}
