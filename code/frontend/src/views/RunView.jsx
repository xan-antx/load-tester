import RunResults from "../components/results/RunResults";
import RunActions from "../components/RunActions";
import SeriesSummary from "../components/SeriesSummary";
import Popover from "../components/Popover";
import Icon from "../components/Icon";
import { formatTime } from "../utils/formatTime";

const STATUS_TEXT = {
  loading: "Loading…",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  timeout: "Timed out",
  cancelled: "Stopped early",
  interrupted: "Interrupted",
};

function Progress({ run }) {
  const total = run.runDuration || 0;
  const frac = total ? Math.min(run.elapsedSec / total, 1) : 0;
  return (
    <div className="progress-block">
      <div
        role="progressbar"
        aria-label="Estimated progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
        className="progress-track"
      >
        <div className="progress-fill" style={{ transform: `scaleX(${frac})` }} />
      </div>
      <div className="progress-foot">
        <span>
          <span className="num">{run.elapsedSec}</span> s of about <span className="num">{total}</span> s
          <span className="muted"> · an estimate: ramp-up and shutdown add a few seconds</span>
        </span>
        {run.testRunning && run.stopState === null && (
          <button type="button" onClick={() => run.setStopState("confirm")} className="btn btn-secondary btn-small">
            <Icon name="stop" size={14} /> Stop test
          </button>
        )}
        {run.testRunning && run.stopState === "confirm" && (
          <span role="group" aria-label="Confirm stopping the test" className="confirm-row">
            <span>Stop now? Results so far are kept.</span>
            <button type="button" onClick={run.stop} className="btn btn-secondary btn-small">Yes, stop</button>
            <button type="button" onClick={() => run.setStopState(null)} className="btn-link">Keep running</button>
          </span>
        )}
        {run.testRunning && run.stopState === "stopping" && <span className="muted">Stopping…</span>}
      </div>
    </div>
  );
}

// Run: live progress, then the result, always from the top of the viewport.
export default function RunView({ run, onNavigate, onRerun, onEdit, onBaselineChanged }) {
  if (!run.jobId) {
    return (
      <div className="empty-state">
        <h1 className="view-title">No run yet</h1>
        <p className="setup-text">Set up a test on New test and press Start; its progress and results appear here.</p>
        <button type="button" className="btn btn-primary" onClick={() => onNavigate("new")}>Set up a test</button>
      </div>
    );
  }

  const result = run.result;
  const config = run.config;
  const url = config?.url || result?.target_url;
  const isGroup = Array.isArray(result?.child_jobs) && result.child_jobs.length > 1;
  const live = ["queued", "running", "loading"].includes(run.status);

  return (
    <div className="run-view">
      <header className="run-head">
        <div className="run-head-main">
          <h1 className="view-title">{live ? (run.status === "loading" ? "Loading run" : "Test in progress") : "Results"}</h1>
          <div className="run-meta">
            {url && <span className="mono run-url" title={url}>{url}</span>}
            <span className="muted">
              Run <span className="mono" title={run.jobId}>{String(run.jobId).slice(0, 8)}</span>
              {result?.created_at && <> · started {formatTime(result.created_at)}</>}
              {result?.users != null && <> · <span className="num">{result.users}</span> users</>}
            </span>
            {isGroup && (
              <span className="meta-chip">
                Split across {result.child_jobs.length} processes
                <Popover label="What is a split run?">
                  Runs above 50 users run as several Locust processes in parallel on the same host (one per 50
                  users, at most 10). Their results are merged; the merged p95 is an estimate, marked ≈.
                </Popover>
              </span>
            )}
          </div>
        </div>
        <span role="status" aria-live="polite" className={`run-status is-${run.status}`}>
          <span className="run-status-dot" aria-hidden="true" />
          {STATUS_TEXT[run.status] || run.status}
        </span>
      </header>

      {["queued", "running"].includes(run.status) && run.runDuration != null && <Progress run={run} />}

      {run.pollState === "retrying" && (
        <p role="status" className="notice">Lost the connection to the backend. Retrying…</p>
      )}
      {run.pollState === "lost" && (
        <div role="alert" className="notice is-danger notice-row">
          <span><strong>Status unknown:</strong> the backend has not answered for 30 seconds.</span>
          <button type="button" onClick={run.checkAgain} className="btn btn-secondary btn-small">Check again</button>
        </div>
      )}

      {config?.pathsUsed?.length > 0 && (
        <p className="setup-text">Pages tested: <span className="mono">{config.pathsUsed.join(", ")}</span></p>
      )}
      {result?.header_names?.length > 0 && (
        <p className="setup-text">
          Sent with request headers <span className="mono">{result.header_names.join(", ")}</span> (values hidden).
        </p>
      )}

      {result?.series_id && <SeriesSummary data={result} />}
      {result && !result.series_id && <RunResults data={result} config={config} regressionInfo={run.regressionInfo} />}

      {result && !live && (
        <RunActions
          run={result}
          config={config}
          regressionInfo={run.regressionInfo}
          markingBaseline={run.markingBaseline}
          onMarkBaseline={async () => {
            if (await run.markBaseline()) onBaselineChanged?.();
          }}
          onRerun={config ? onRerun : null}
          onEdit={config ? onEdit : null}
          rerunBlocked={run.testRunning || run.starting}
        />
      )}
      {result && !live && !config && (
        <p className="field-note">
          This run was started from another browser or the CLI, so its cases and payloads are not known here.
          Re-run is available for runs started from this browser.
        </p>
      )}
      {(run.actionError || run.startError) && (
        <p role="alert" className="field-error">
          <Icon name="alert" size={14} /> {run.actionError || run.startError}
        </p>
      )}
      {run.busyNotice && <p role="status" className="field-note">Server busy: {run.busyNotice}</p>}
    </div>
  );
}
