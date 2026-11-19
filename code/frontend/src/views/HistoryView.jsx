import { useEffect, useRef, useState } from "react";
import CompareView from "../components/CompareView";
import { VerdictChip } from "../components/SloVerdict";
import Icon from "../components/Icon";
import Popover from "../components/Popover";
import { request } from "../api";
import { runReport } from "../utils/runReport";
import { loadAllRunConfigs } from "../utils/runStore";
import { relativeTime } from "../utils/relativeTime";
import { formatTime } from "../utils/formatTime";

const STATUS_TEXT = {
  queued: "Queued", running: "Running", completed: "Completed", failed: "Failed",
  timeout: "Timed out", cancelled: "Stopped early", interrupted: "Interrupted",
};

// Findings per finished run, computed from its status once (finished runs
// never change). Kept for the page's lifetime.
const summaryCache = new Map();
const SUMMARY_LIMIT = 25;

function useRunSummaries(jobs) {
  const [, bump] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const todo = jobs.filter((j) => j.status === "completed" && !summaryCache.has(j.id)).slice(0, SUMMARY_LIMIT);
    (async () => {
      for (const j of todo) {
        try {
          const { ok, data } = await request(`/api/load-test-status/${j.id}`);
          if (!ok || !data) continue;
          const r = runReport(data, null);
          summaryCache.set(j.id, { bugs: r.bugCaseCount, untested: r.untested.length, cases: r.cases.length });
        } catch {
          return;
        }
        if (cancelled) return;
        bump((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs]);
  return summaryCache;
}

function Findings({ summary }) {
  if (!summary) return <span className="muted">—</span>;
  if (summary.bugs > 0) {
    return (
      <span className="finding-cell is-bad">
        <Icon name="cross" size={14} /> {summary.bugs} with bugs
        {summary.untested > 0 && <span className="muted"> · {summary.untested} not tested</span>}
      </span>
    );
  }
  if (summary.untested > 0) return <span className="finding-cell"><Icon name="untested" dashed size={14} /> {summary.untested} not tested</span>;
  return <span className="finding-cell"><Icon name="check" size={14} /> No bugs</span>;
}

// History: every run, baselines, and Compare (2 to 4 runs, one reference).
export default function HistoryView({ history, onOpenRun, onMarkBaseline, liveRunId }) {
  const { jobs, loaded, loadError, compareIds } = history;
  const configs = loadAllRunConfigs();
  const summaries = useRunSummaries(jobs);
  const [baselineBusy, setBaselineBusy] = useState(null);
  const [baselineError, setBaselineError] = useState(null);
  const compareRef = useRef(null);

  // The comparison renders below the run table, often off-screen: bring it
  // into view (and focus it) when it arrives, so Compare visibly does something.
  useEffect(() => {
    if (!history.compareResult || !compareRef.current) return;
    // Instant, not smooth: smooth scrolling is ignored in some embedded browsers.
    compareRef.current.scrollIntoView({ block: "start" });
    compareRef.current.focus({ preventScroll: true });
  }, [history.compareResult]);

  const showMode = jobs.some((j) => j.mode === "capacity");
  const showVerdict = jobs.some((j) => j.slo_verdict);
  const showFindings = jobs.some((j) => j.status === "completed");

  async function makeBaseline(id) {
    setBaselineBusy(id);
    setBaselineError(null);
    const err = await onMarkBaseline(id);
    if (err) setBaselineError(err);
    setBaselineBusy(null);
  }

  if (!loaded) return <p className="setup-text">Loading runs…</p>;

  return (
    <div className="history-view">
      <div className="view-head">
        <h1 className="view-title">History</h1>
        <button type="button" className="btn-link" onClick={history.refresh}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>
      {loadError && <p role="alert" className="field-error"><Icon name="alert" size={14} /> {loadError}</p>}

      {jobs.length === 0 && !loadError ? (
        <div className="empty-state">
          <p className="setup-text">No runs yet. Every test you start appears here, ready to open again or compare.</p>
        </div>
      ) : (
        <>
          <div className="compare-bar" aria-live="polite">
            <span>
              {compareIds.length === 0 && "Tick 2 to 4 runs to compare them. The first one you tick is the reference."}
              {compareIds.length === 1 && "Tick at least one more run to compare."}
              {compareIds.length >= 2 && <><strong>{compareIds.length} runs</strong> selected{compareIds.length === 4 ? " (the maximum)" : ""}.</>}
            </span>
            <button type="button" className="btn btn-primary" onClick={history.compare} disabled={compareIds.length < 2 || history.comparing}>
              {history.comparing ? "Comparing…" : "Compare"}
            </button>
            {compareIds.length > 0 && (
              <button type="button" className="btn-link" onClick={history.clearCompare}>Clear selection</button>
            )}
          </div>
          {history.compareError && <p role="alert" className="field-error"><Icon name="alert" size={14} /> {history.compareError}</p>}
          {baselineError && <p role="alert" className="field-error"><Icon name="alert" size={14} /> {baselineError}</p>}

          <div className="table-scroll">
            <table className="data-table history-table">
              <thead>
                <tr>
                  <th scope="col">Compare</th>
                  <th scope="col">When</th>
                  <th scope="col">Target</th>
                  <th scope="col" className="num">Users</th>
                  {showMode && <th scope="col">Mode</th>}
                  <th scope="col">Status</th>
                  {showFindings && <th scope="col">Findings</th>}
                  {showVerdict && <th scope="col">SLO</th>}
                  <th scope="col">
                    Baseline
                    <Popover label="What is a baseline?" align="end">
                      A known-good run of a target. Every later run of the same target is compared with it, and
                      cases that got worse are flagged.
                    </Popover>
                  </th>
                  <th scope="col"><span className="visually-hidden">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const pos = compareIds.indexOf(j.id);
                  const picked = pos !== -1;
                  const full = !picked && compareIds.length >= 4;
                  const url = configs[j.id]?.url || j.target_url;
                  return (
                    <tr key={j.id} className={picked ? "is-picked" : undefined}>
                      <td className="check-cell">
                        <div className="compare-cell">
                          <input
                            type="checkbox"
                            checked={picked}
                            disabled={full}
                            onChange={() => history.toggleCompare(j.id)}
                            aria-label={`Compare the run of ${relativeTime(j.created_at)}, ${j.users} users, ${url}`}
                          />
                          {pos === 0 && <span className="ref-tag">Reference</span>}
                          {pos > 0 && (
                            <button type="button" className="btn-link" onClick={() => history.setReference(j.id)}>
                              Make reference
                            </button>
                          )}
                        </div>
                      </td>
                      <td title={formatTime(j.created_at)}>{relativeTime(j.created_at)}</td>
                      <td className="url-cell"><span className="mono" title={url}>{url}</span></td>
                      <td className="num">{j.users}</td>
                      {showMode && <td>{j.mode === "capacity" ? "Find capacity" : "Fixed"}</td>}
                      <td className={`status-cell is-${j.status}`}>
                        {STATUS_TEXT[j.status] || j.status}
                        {j.isGroup && <span className="muted"> · split</span>}
                      </td>
                      {showFindings && <td>{j.status === "completed" ? <Findings summary={summaries.get(j.id)} /> : <span className="muted">—</span>}</td>}
                      {showVerdict && <td>{j.slo_verdict ? <VerdictChip verdict={j.slo_verdict} /> : <span className="muted">—</span>}</td>}
                      <td>
                        {j.is_baseline ? (
                          <span className="baseline-tag"><Icon name="star" size={14} /> Baseline</span>
                        ) : j.status === "completed" ? (
                          <button type="button" className="btn-link" onClick={() => makeBaseline(j.id)} disabled={baselineBusy === j.id}>
                            {baselineBusy === j.id ? "Saving…" : "Make baseline"}
                          </button>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() => onOpenRun(j.id)}
                          disabled={liveRunId != null && liveRunId !== j.id}
                          title={liveRunId != null && liveRunId !== j.id ? "A test is running; open it when it has finished" : undefined}
                        >
                          {liveRunId === j.id ? "Watch" : "Open"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {history.compareResult?.jobs && (
            <section ref={compareRef} tabIndex={-1} className="block compare-result" aria-label="Comparison" style={{ outline: "none", scrollMarginTop: 16 }}>
              <CompareView
                jobs={history.compareResult.jobs}
                caseComparison={history.compareResult.case_comparison}
                configs={history.compareResult.jobs.map((j) => configs[j.job_id || j.group_id] || null)}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
