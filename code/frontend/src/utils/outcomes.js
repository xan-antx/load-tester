// Turns the backend's failure_summary (failures grouped by HTTP status) into
// "how did each request end?" counts, for the outcome strips.
// Pure functions: no React, no fetching.

// accepted_invalid_input / rejected_valid_input only appear in runs whose
// cases carry an expected outcome; "rejected" (any 4xx) only in older runs.
const FAILURE_KINDS = [
  "accepted_invalid_input", "rejected_valid_input",
  "rejected", "rate_limited", "server_error", "connection", "other",
];

function emptyCounts() {
  return Object.fromEntries(FAILURE_KINDS.map((k) => [k, 0]));
}

// { caseName: { <kind>: count, ... } } for every kind in FAILURE_KINDS
export function failuresByCase(failureSummary) {
  const byCase = {};
  for (const group of failureSummary || []) {
    const kind = FAILURE_KINDS.includes(group.kind) ? group.kind : "other";
    for (const c of group.cases || []) {
      byCase[c.case] = byCase[c.case] || emptyCounts();
      byCase[c.case][kind] += Number(c.occurrences) || 0;
    }
  }
  return byCase;
}

// Totals per failure kind across the whole run.
export function failuresByKind(failureSummary) {
  const totals = emptyCounts();
  for (const group of failureSummary || []) {
    const kind = FAILURE_KINDS.includes(group.kind) ? group.kind : "other";
    totals[kind] += Number(group.total) || 0;
  }
  return totals;
}

// Splits `requests` into outcome segments. Whatever isn't a counted failure
// is "passed". If the failure counts are missing (older runs) but we know the
// failure total, it is shown as "other" so the strip still adds up.
export function outcomeSegments(requests, kindCounts, failureTotal) {
  const counts = { ...emptyCounts(), ...(kindCounts || {}) };
  let counted = FAILURE_KINDS.reduce((sum, k) => sum + counts[k], 0);
  if (failureTotal != null && counted < failureTotal) {
    counts.other += failureTotal - counted;
    counted = failureTotal;
  }
  const passed = Math.max((Number(requests) || 0) - counted, 0);
  return [
    { key: "passed", count: passed },
    ...FAILURE_KINDS.map((k) => ({ key: k, count: counts[k] })),
  ].filter((s) => s.count > 0);
}
