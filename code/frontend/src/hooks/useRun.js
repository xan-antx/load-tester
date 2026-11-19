import { useEffect, useRef, useState } from "react";
import { request, describeError, networkError } from "../api";
import { saveRunConfig, loadRunConfig } from "../utils/runStore";

// 15 failed polls at 2 s each: about 30 seconds without the backend.
const MAX_POLL_FAILURES = 15;
const TERMINAL = ["completed", "failed", "timeout", "cancelled", "interrupted"];

// One run at a time: starting (from a config, so New test and "Re-run" share
// the same path), polling, stopping, the result, and its baseline comparison.
export default function useRun({ onFinished, onNetworkError } = {}) {
  const [jobId, setJobId] = useState(null);
  const [config, setConfig] = useState(null);
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [runDuration, setRunDuration] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [regressionInfo, setRegressionInfo] = useState(null);
  const [markingBaseline, setMarkingBaseline] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const [busyNotice, setBusyNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  // null = fine, "retrying" = the last poll failed, "lost" = polling gave up.
  const [pollState, setPollState] = useState(null);
  // "Stop test": null, "confirm" (asking), or "stopping" (request sent).
  const [stopState, setStopState] = useState(null);
  const pollToken = useRef(0);

  const testRunning = (status === "queued" || status === "running") && pollState !== "lost";

  // Elapsed-time ticker for the in-flight run; the completion signal still
  // comes from polling.
  useEffect(() => {
    if (!runStartedAt || !["queued", "running"].includes(status)) return;
    const timer = setInterval(() => setElapsedSec(Math.floor((Date.now() - runStartedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [runStartedAt, status]);

  async function loadRegressionInfo(id) {
    try {
      const { ok, data } = await request(`/api/regressions/${id}`);
      if (ok) setRegressionInfo(data);
    } catch {
      // optional extra: the result itself is already on screen
    }
  }

  function poll(id) {
    const token = ++pollToken.current;
    let failures = 0;
    const tick = async () => {
      if (token !== pollToken.current) return; // a newer run or view replaced this one
      let data;
      try {
        ({ data } = await request(`/api/load-test-status/${id}`));
      } catch {
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          setPollState("lost");
          onNetworkError?.();
          return;
        }
        setPollState("retrying");
        setTimeout(tick, 2000);
        return;
      }
      if (token !== pollToken.current) return;
      failures = 0;
      setPollState(null);
      if (!data || data.error) {
        setStatus("failed");
        setResult({ status: "failed", error: data?.error || "This run could not be found." });
        return;
      }
      setStatus(data.status);
      if (TERMINAL.includes(data.status)) {
        setResult(data);
        setStopState(null);
        if (data.status === "completed" && !data.series_id) loadRegressionInfo(id);
        onFinished?.(data);
        return;
      }
      setTimeout(tick, 2000);
    };
    tick();
  }

  // config: {kind, url, cases?, sample?, sitemapRaw?, settings, runMode,
  // capPlan, slo, modeFields, expectedSeconds}; headers and ownership are
  // passed separately and never stored.
  async function start(cfg, { headers, ownTarget }) {
    if (testRunning || starting) return false;
    setStartError(null);
    setBusyNotice(null);
    setActionError(null);
    setStarting(true);
    try {
      const s = cfg.settings;
      const common = {
        url: cfg.url,
        headers,
        i_own_target: ownTarget,
        slo: cfg.slo || undefined,
        users: s.users,
        spawn_rate: s.spawnRate,
        duration_seconds: s.duration,
        repeat: s.repeat,
        ...(cfg.modeFields || {}),
      };
      let resp;
      if (cfg.kind === "website") {
        resp = await request("/api/start-website-load-test", { method: "POST", body: { ...common, sitemap_raw: cfg.sitemapRaw } });
      } else {
        const generated = cfg.cases.filter((c) => !c.isCustom);
        const custom = cfg.cases.filter((c) => c.isCustom).map((c) => ({ label: c.label, payload: c.payload, expect: c.expect }));
        const expectations = Object.fromEntries(generated.filter((c) => c.expect).map((c) => [c.label, c.expect]));
        const confirm = await request("/api/confirm-selection", {
          method: "POST",
          body: { sample_input: cfg.sample, selected_labels: generated.map((c) => c.label), custom_cases: custom, expectations },
        });
        if (!confirm.ok) {
          setStartError(describeError(confirm.data, "Could not confirm the selected cases"));
          return false;
        }
        resp = await request("/api/start-load-test", { method: "POST", body: { ...common, confirmed_cases: confirm.data.confirmed_cases } });
      }
      if (resp.status === 429) {
        setBusyNotice(resp.data?.error || "Another load test is still running. Try again when it has finished.");
        return false;
      }
      if (!resp.ok) {
        setStartError(describeError(resp.data, "Could not start the load test"));
        return false;
      }
      const id = resp.data.job_id;
      const stored = { ...cfg, pathsUsed: resp.data.paths_used || null };
      delete stored.modeFields;
      saveRunConfig(id, stored);
      setConfig(stored);
      setJobId(id);
      setRunStartedAt(Date.now());
      setRunDuration(cfg.expectedSeconds);
      setElapsedSec(0);
      setStatus("queued");
      setResult(null);
      setRegressionInfo(null);
      setPollState(null);
      setStopState(null);
      poll(id);
      return true;
    } catch {
      setStartError(networkError());
      onNetworkError?.();
      return false;
    } finally {
      setStarting(false);
    }
  }

  // Shows a past run (from History). A running one keeps polling.
  function openRun(id) {
    if (testRunning && id === jobId) return;
    if (testRunning) return; // the live run stays on screen; History links say so
    setJobId(id);
    setConfig(loadRunConfig(id));
    setResult(null);
    setRegressionInfo(null);
    setStatus("loading");
    setRunStartedAt(null);
    setRunDuration(null);
    setPollState(null);
    setStopState(null);
    poll(id);
  }

  function checkAgain() {
    setPollState("retrying");
    poll(jobId);
  }

  async function stop() {
    setStopState("stopping");
    try {
      const { ok, data } = await request(`/api/cancel/${jobId}`, { method: "POST" });
      if (!ok) {
        setActionError(describeError(data, "Could not stop the test"));
        setStopState(null);
      }
      // On success polling sees "cancelled" once Locust has exited.
    } catch {
      setActionError(networkError());
      setStopState(null);
    }
  }

  async function markBaseline() {
    setMarkingBaseline(true);
    setActionError(null);
    try {
      const { ok, data } = await request("/api/baseline", { method: "POST", body: { id: jobId } });
      if (!ok) {
        setActionError(data?.error || "Could not mark this run as the baseline.");
        return false;
      }
      await loadRegressionInfo(jobId);
      return true;
    } catch {
      setActionError(networkError());
      return false;
    } finally {
      setMarkingBaseline(false);
    }
  }

  return {
    jobId, config, status, result, regressionInfo, elapsedSec, runDuration,
    testRunning, starting, startError, setStartError, busyNotice, actionError, setActionError,
    pollState, stopState, setStopState,
    start, stop, openRun, checkAgain, markBaseline, markingBaseline,
  };
}
