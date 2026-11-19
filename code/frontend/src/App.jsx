import AppHeader from "./components/AppHeader";
import { headersObject } from "./components/RequestHeadersEditor";
import NewTestView from "./views/NewTestView";
import RunView from "./views/RunView";
import HistoryView from "./views/HistoryView";
import useHealth from "./hooks/useHealth";
import useView from "./hooks/useView";
import useTarget from "./hooks/useTarget";
import useCases from "./hooks/useCases";
import useLoadSettings, { modeFieldsFor, expectedSecondsFor } from "./hooks/useLoadSettings";
import useRun from "./hooks/useRun";
import useHistory from "./hooks/useHistory";
import { BASE, request } from "./api";

// A running test stays visible from every view.
function RunPill({ run, onOpen }) {
  if (!run.testRunning) return null;
  const total = run.runDuration || 0;
  const frac = total ? Math.min(run.elapsedSec / total, 1) : 0;
  return (
    <button
      type="button"
      className="run-pill"
      onClick={onOpen}
      aria-label={`Test running, ${run.elapsedSec} of about ${total} seconds. Open the run.`}
    >
      <span className="run-pill-dot" aria-hidden="true" />
      <span>Running</span>
      <span className="num">{run.elapsedSec}/{total}s</span>
      <span className="run-pill-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${frac})` }} />
      </span>
    </button>
  );
}

// Three views over shared state: New test (setup), Run (progress and
// results) and History (runs, baselines, Compare).
export default function App() {
  const [view, navigate] = useView();
  const { health, recheck, markOffline } = useHealth(BASE);
  const history = useHistory();
  const cases = useCases({ onNetworkError: markOffline });
  const target = useTarget({ onNewTarget: cases.reset, onNetworkError: markOffline });
  const load = useLoadSettings();
  const run = useRun({ onFinished: () => history.refresh(), onNetworkError: markOffline });

  function currentConfig() {
    const settings = load.settings();
    return {
      kind: target.isWebsite ? "website" : "api",
      url: target.analyzedUrl,
      sample: cases.sampleInput,
      sitemapRaw: target.sitemapRaw,
      cases: target.isWebsite
        ? []
        : cases.selectedCases.map((c) => ({
            label: c.label,
            payload: c.payload,
            expect: cases.expectOf(c),
            description: c.description,
            category: c.category,
            isCustom: !!c.isCustom,
          })),
      settings,
      runMode: load.runMode,
      capPlan: load.capPlan,
      slo: load.sloPayload() || null,
      modeFields: load.modeFields(),
      expectedSeconds: load.expectedSeconds(),
    };
  }

  async function startTest() {
    const ok = await run.start(currentConfig(), {
      headers: headersObject(target.requestHeaders),
      ownTarget: target.ownTarget,
    });
    if (ok) {
      navigate("run");
      history.refresh();
    }
  }

  // Re-run with the stored configuration of the run on screen. The user
  // confirmed ownership of this exact target when the run was first started.
  async function rerun() {
    const cfg = run.config;
    if (!cfg) return;
    const sameTarget = cfg.url === target.url;
    const ok = await run.start(
      {
        ...cfg,
        modeFields: modeFieldsFor(cfg.runMode, cfg.capPlan),
        expectedSeconds: expectedSecondsFor(cfg.runMode, cfg.capPlan, cfg.settings),
      },
      { headers: sameTarget ? headersObject(target.requestHeaders) : {}, ownTarget: true }
    );
    if (ok) {
      window.scrollTo({ top: 0 });
      history.refresh();
    }
  }

  async function editAndRerun() {
    const cfg = run.config;
    if (!cfg) return;
    target.restore(cfg);
    load.restore(cfg);
    navigate("new");
    if (cfg.kind !== "website") await cases.restore(cfg);
  }

  async function markBaselineFromHistory(id) {
    try {
      const { ok, data } = await request("/api/baseline", { method: "POST", body: { id } });
      if (!ok) return data?.error || "Could not mark that run as the baseline.";
      history.refresh();
      return null;
    } catch {
      markOffline();
      return "The backend did not answer.";
    }
  }

  const views = [
    { id: "new", label: "New test" },
    { id: "run", label: "Run" },
    { id: "history", label: "History", badge: history.jobs.length || null },
  ];

  return (
    <div className="app">
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="app-frame">
        <AppHeader
          apiBase={BASE}
          health={health}
          onRecheck={recheck}
          views={views}
          view={view}
          onNavigate={navigate}
          runPill={view !== "run" ? <RunPill run={run} onOpen={() => navigate("run")} /> : null}
        />
        <main id="main" tabIndex={-1} className="app-main view-enter" key={view}>
          {view === "new" && <NewTestView target={target} cases={cases} load={load} run={run} onStart={startTest} />}
          {view === "run" && (
            <RunView run={run} onNavigate={navigate} onRerun={rerun} onEdit={editAndRerun} onBaselineChanged={history.refresh} />
          )}
          {view === "history" && (
            <HistoryView
              history={history}
              liveRunId={run.testRunning ? run.jobId : null}
              onMarkBaseline={markBaselineFromHistory}
              onOpenRun={(id) => {
                run.openRun(id);
                navigate("run");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
