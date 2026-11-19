import { useState } from "react";
import FindingsHeadline from "./FindingsHeadline";
import CaseResultsTable from "./CaseResultsTable";
import FailureReasons from "./FailureReasons";
import BaselineComparison from "./BaselineComparison";
import Timeline from "../Timeline";
import OutcomeStrip from "../OutcomeStrip";
import SloVerdict from "../SloVerdict";
import CapacityResult from "../CapacityResult";
import Popover from "../Popover";
import { runReport, formatPct, formatMs } from "../../utils/runReport";

const UNEXPECTED_HELP =
  "An answer is unexpected when it is not what a correct API would give: 2xx for valid input, " +
  "a 4xx rejection for invalid input. A 429 (rate limited), a 5xx (server error) or no answer at all " +
  "is always unexpected. The same figure is used in the bar, the table and the chart.";
const P95_HELP =
  "p95: 95% of requests were faster than this. It shows the slow tail that an average hides.";
const P95_APPROX_HELP =
  " This run was split into parallel processes on the same host, and percentiles cannot be merged " +
  "exactly, so the value is a request-weighted estimate (≈).";

function KeyFigure({ label, value, note, help }) {
  return (
    <div className="kpi">
      <div className="kpi-label">
        {label}
        {help && <Popover label={`What is "${label}"?`}>{help}</Popover>}
      </div>
      <div className="kpi-value">{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

function StatusNotice({ data, hasStats }) {
  const tail = hasStats ? " The figures below cover only what was recorded." : " No results were recorded.";
  if (data.status === "failed" || data.status === "timeout") {
    return (
      <div role="alert" className="notice is-danger">
        <strong>{data.status === "timeout" ? "The run timed out." : "The run failed."}</strong>{" "}
        {data.status === "timeout"
          ? "Locust did not finish within the run's duration plus a minute, so it was stopped."
          : !data.error && "No error message was recorded."}
        {tail}
        {data.error && <pre className="code-block">{data.error}</pre>}
      </div>
    );
  }
  if (data.status === "interrupted") {
    return (
      <div role="alert" className="notice is-warning">
        <strong>Interrupted.</strong> {data.error || "The backend stopped while this run was in progress, so it never finished."}
        {tail}
      </div>
    );
  }
  if (data.status === "cancelled") {
    return (
      <div role="status" className="notice">
        <strong>Stopped early: partial results.</strong>
        {hasStats ? " The figures below cover only the part of the test that ran." : " Nothing was recorded before the test was stopped."}
      </div>
    );
  }
  return null;
}

// The results of one finished run, in the order PRODUCT.md asks for:
// findings (bugs, with cases and payloads), coverage, the key figures, the
// SLO as a secondary card, then the evidence.
export default function RunResults({ data, config, regressionInfo }) {
  const [showRaw, setShowRaw] = useState(false);
  const report = runReport(data, config);
  const hasStats = !!report.aggregated;
  const approx = report.isGroup ? "≈" : "";
  const finished = data.status === "completed" || (data.status === "cancelled" && hasStats);

  return (
    <div className="results">
      <StatusNotice data={data} hasStats={hasStats} />

      {finished && hasStats && <FindingsHeadline report={report} />}

      {hasStats && (
        <>
          <div className="kpi-row">
            <KeyFigure label="Requests" value={report.requests.toLocaleString()} />
            <KeyFigure
              label="Unexpected answers"
              value={formatPct(report.unexpectedPct)}
              note={`${report.unexpected.toLocaleString()} of ${report.requests.toLocaleString()}`}
              help={UNEXPECTED_HELP}
            />
            <KeyFigure
              label="p95 response"
              value={`${approx}${formatMs(report.p95)} ms`}
              note={report.isGroup ? "estimate (split run)" : "95% were faster"}
              help={P95_HELP + (report.isGroup ? P95_APPROX_HELP : "")}
            />
            <KeyFigure label="Average" value={`${formatMs(report.avg)} ms`} />
            <KeyFigure label="Requests / s" value={report.rps == null ? "—" : report.rps.toFixed(1)} />
            <KeyFigure label="Duration" value={data.duration_seconds != null ? `${data.duration_seconds} s` : "—"} />
          </div>

          <div className="outcome-block">
            <div className="outcome-caption">How the {report.requests.toLocaleString()} requests were answered</div>
            <OutcomeStrip
              requests={report.requests}
              kindCounts={report.kinds}
              failureTotal={report.unexpected}
              size="large"
              passedLabel={report.hasExpectations ? "Expected answer" : "Succeeded"}
            />
          </div>
        </>
      )}

      {!hasStats && data.status === "completed" && (
        <p className="notice">
          The run finished but recorded no statistics. Check that the target was reachable and try again.
        </p>
      )}

      <SloVerdict verdict={data.slo_verdict} approximate={report.isGroup} />
      {data.mode === "capacity" && <CapacityResult capacity={data.capacity} plan={data.capacity_plan} slo={data.slo} />}
      <BaselineComparison info={regressionInfo} approximate={report.isGroup} />

      <CaseResultsTable report={report} />
      <FailureReasons data={data} report={report} />
      <Timeline
        historyCsv={data.aggregated_history_csv || data.history_csv}
        approximate={report.isGroup}
        slo={data.slo}
        unexpectedLabel={report.hasExpectations ? "Unexpected/s" : "Failed/s"}
      />

      <div className="block-foot">
        <button type="button" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw} className="btn-link">
          {showRaw ? "Hide raw response" : "Show raw response"}
        </button>
      </div>
      {showRaw && <pre className="code-block">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
