import { useState, useEffect, useRef } from "react";
import Section, { inputStyle, labelStyle } from "./components/Section";
import AnalyzeSummary from "./components/AnalyzeSummary";
import JobResultSummary from "./components/JobResultSummary";
import CompareView from "./components/CompareView";
import WebsiteLoadTestSection from "./components/WebsiteLoadTestSection";
import LoadTestConfig, { LIMITS, clampInt } from "./components/LoadTestConfig";
import RunActions from "./components/RunActions";
import SeriesSummary from "./components/SeriesSummary";
import AppHeader from "./components/AppHeader";
import StepRail from "./components/StepRail";
import RequestHeadersEditor, { headersObject } from "./components/RequestHeadersEditor";
import OwnershipCheck from "./components/OwnershipCheck";
import SloConfig, { DEFAULT_SLO, sloPayload } from "./components/SloConfig";
import { VerdictChip } from "./components/SloVerdict";
import CapacityConfig, { RunModeToggle, capacitySteps, CAPACITY_LIMITS } from "./components/CapacityConfig";
import { colors, font, space, radius, type, z } from "./theme";
import { formatTime } from "./utils/formatTime";

const BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

// Section 3 groups the selectable cases under these headings.
// Shown when a request to the backend fails before any response arrives.
function networkError(err) {
  return `${err.message} (Is the backend reachable at ${BASE}?)`;
}

// Backend errors come back as {error: "..."}; show that sentence rather than
// the raw JSON, and fall back to the JSON only when there is nothing else.
function describeError(data, fallback) {
  if (data?.error) return data.error;
  if (data?.reason) return data.reason;
  return data ? `${fallback}: ${JSON.stringify(data)}` : fallback;
}

// 15 failed polls at 2 s each: about 30 seconds without the backend.
const MAX_POLL_FAILURES = 15;

const TARGET_CHANGED_MESSAGE =
  "The target URL has changed since it was analyzed. Click Analyze before starting a test.";

function smoothOrAuto() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

// Small icon buttons (×) still get a 24 × 24 px hit area (WCAG 2.5.8).
const iconButtonStyle = {
  minWidth: 24,
  minHeight: 24,
  display: "inline-grid",
  placeItems: "center",
  color: colors.textMuted,
  fontSize: type.heading,
  lineHeight: 1,
};

const CASE_CATEGORY_LABELS = {
  valid_input: "Valid sample",
  missing_field: "Missing field",
  null_value: "Null value",
  type_mismatch: "Type mismatch",
  boundary_value: "Boundary value",
  known_attack: "Known attack",
  custom: "Your own cases",
};

export default function App() {
  // Build-time defaults (docker compose pre-fills the local mock target).
  const [url, setUrl] = useState(import.meta.env.VITE_DEFAULT_TARGET || "https://dummyjson.com/auth/login");
  const [analyzeResult, setAnalyzeResult] = useState(null);
  // The URL the last analysis ran on. Tests only start while the field still
  // holds this URL, so cases built for one target are never sent to another.
  const [analyzedUrl, setAnalyzedUrl] = useState(null);
  const [isApi, setIsApi] = useState(false);
  const [isWebsite, setIsWebsite] = useState(false);
  const [sitemapRaw, setSitemapRaw] = useState(null);
  const [showRawAnalyze, setShowRawAnalyze] = useState(false);

  const [sampleInputText, setSampleInputText] = useState(
    import.meta.env.VITE_DEFAULT_SAMPLE || '{"username": "emilys", "password": "emilyspass", "expiresInMins": 30}'
  );
  const [sampleInput, setSampleInput] = useState(null);
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState({});
  // User-written cases that passed /api/validate-custom-case:
  // [{label, payload, description, classified_as}]
  const [customCases, setCustomCases] = useState([]);
  const [customLabel, setCustomLabel] = useState("");
  const [customPayloadText, setCustomPayloadText] = useState("");
  const [customMessage, setCustomMessage] = useState(null);
  // Expected answer for the next custom case ("reject" = expects a 4xx).
  const [customExpect, setCustomExpect] = useState("reject");
  // Per-label overrides of a generated case's expected answer, e.g. an
  // optional field the API is right to accept: { label: "accept" | "reject" }.
  const [expectOverrides, setExpectOverrides] = useState({});
  // "I own this target or have permission to load-test it" (required).
  const [ownTarget, setOwnTarget] = useState(false);
  // SLO thresholds the run is judged against (text while typing).
  const [sloEnabled, setSloEnabled] = useState(true);
  const [sloValues, setSloValues] = useState(DEFAULT_SLO);
  // "fixed": one load level; "capacity": step load to find the breaking point.
  const [runMode, setRunMode] = useState("fixed");
  // Its own spawn rate (20/s): each step must reach its users quickly,
  // whereas a fixed run's default ramp is 1 user per second.
  const [capPlan, setCapPlan] = useState({ start: 20, step: 20, stepSeconds: 12, max: 200, earlyStop: true, spawn: 20 });
  // Optional request headers: [{id, name, value}]. Kept in memory only.
  const [requestHeaders, setRequestHeaders] = useState([]);

  const [testUsers, setTestUsers] = useState(3);
  const [testSpawnRate, setTestSpawnRate] = useState(1);
  // 30 s by default: shorter runs give too few requests per case to compare.
  const [testDuration, setTestDuration] = useState(30);
  // How many times to run the same test back to back (a "series").
  const [testRepeat, setTestRepeat] = useState(1);

  const [jobId, setJobId] = useState(null);
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [runDuration, setRunDuration] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobResult, setJobResult] = useState(null);
  const [showRawJob, setShowRawJob] = useState(false);
  const [websitePathsUsed, setWebsitePathsUsed] = useState(null);
  // /api/regressions response for the current result (baseline comparison).
  const [regressionInfo, setRegressionInfo] = useState(null);
  const [markingBaseline, setMarkingBaseline] = useState(false);

  const [jobHistory, setJobHistory] = useState([]);
  // Run ids ticked for comparison, in the order they were ticked (the first
  // one is the reference the other runs are compared against).
  const [compareIds, setCompareIds] = useState([]);
  const [compareResult, setCompareResult] = useState(null);

  const [error, setError] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [startingWebsiteTest, setStartingWebsiteTest] = useState(false);
  const [startingApiTest, setStartingApiTest] = useState(false);
  // Set when the backend refuses a start with 429 because another load test
  // (from any browser or the CLI) is still running. Shown next to the start
  // button as a notice rather than as an error.
  const [busyNotice, setBusyNotice] = useState(null);
  // Status polling health: null = fine, "retrying" = the last poll failed,
  // "lost" = MAX_POLL_FAILURES polls in a row failed and polling stopped.
  const [pollState, setPollState] = useState(null);
  // "Stop test": null, "confirm" (asking), or "stopping" (request sent).
  const [stopState, setStopState] = useState(null);
  const errorRef = useRef(null);

  useEffect(() => {
    refreshJobHistory();
  }, []);

  // The error banner sits at the top of the page; bring it into view (and
  // give it focus for keyboard users) so a failed click never looks ignored.
  useEffect(() => {
    if (!error || !errorRef.current) return;
    errorRef.current.scrollIntoView({ behavior: smoothOrAuto(), block: "nearest" });
    errorRef.current.focus({ preventScroll: true });
  }, [error]);

  // When a run starts, scroll to its progress panel.
  useEffect(() => {
    if (!jobId) return;
    document.getElementById("step-4")?.scrollIntoView({ behavior: smoothOrAuto(), block: "start" });
  }, [jobId]);

  // Elapsed-time ticker for the in-flight run; purely cosmetic, the actual
  // completion signal still comes from pollStatus().
  useEffect(() => {
    if (!runStartedAt || !["queued", "running"].includes(jobStatus)) return;
    const timer = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - runStartedAt) / 1000)),
      500
    );
    return () => clearInterval(timer);
  }, [runStartedAt, jobStatus]);

  // Once a run finishes, ask the backend how it compares with its target's
  // baseline. Kept out of pollStatus() on purpose.
  useEffect(() => {
    // Clearing the previous run's comparison is intended (a new result
    // replaces it); the request below then fills it in.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRegressionInfo(null);
    if (jobResult?.status === "completed" && jobId && !jobResult.series_id) {
      loadRegressionInfo(jobId);
    }
  }, [jobResult, jobId]);

  async function loadRegressionInfo(id) {
    try {
      const resp = await fetch(`${BASE}/api/regressions/${id}`);
      if (resp.ok) setRegressionInfo(await resp.json());
    } catch {
      // optional extra — the result itself is already on screen
    }
  }

  async function markAsBaseline() {
    setMarkingBaseline(true);
    try {
      const resp = await fetch(`${BASE}/api/baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jobId }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Could not mark this run as the baseline");
        return;
      }
      await loadRegressionInfo(jobId);
      refreshJobHistory();
    } catch (err) {
      setError(networkError(err));
    } finally {
      setMarkingBaseline(false);
    }
  }

  async function refreshJobHistory() {
    try {
      const resp = await fetch(`${BASE}/api/jobs`);
      const data = await resp.json();
      const jobs = (data.jobs || []).map((j) => ({ ...j, id: j.job_id }));
      const groups = (data.job_groups || []).map((g) => ({ ...g, id: g.group_id }));
      const combined = [...jobs, ...groups].sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || "")
      );
      setJobHistory(combined);
    } catch {
      // silent — history is a nice-to-have, don't block the main flow on it
    }
  }

  async function analyzeUrl() {
    setError(null);
    if (!/^https?:\/\/[^\s/]+/i.test(url.trim())) {
      setError("Enter a full URL starting with http:// or https://, for example https://example.com/api/login");
      return;
    }
    setAnalyzing(true);
    setAnalyzeResult(null);
    setSitemapRaw(null);
    try {
      const resp = await fetch(`${BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, headers: headersObject(requestHeaders) }),
      });
      const data = await resp.json();
      setAnalyzeResult(data);
      // A different target: the old cases were built for the old one.
      if (url !== analyzedUrl) {
        setOwnTarget(false);
        setExpectOverrides({});
        setCases([]);
        setCustomCases([]);
        setSelected({});
        setCustomMessage(null);
      }
      setAnalyzedUrl(url);

      const classification = data.type_detection?.classification;
      setIsApi(resp.ok && classification === "api");
      setIsWebsite(resp.ok && classification === "website");
      if (data.sitemap?.raw) {
        setSitemapRaw(data.sitemap.raw);
      }

      if (!resp.ok) {
        setError(data.error || "Could not reach or analyze that URL");
      }
    } catch (err) {
      setError(`${err.message} (Is the backend reachable at ${BASE}?)`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function generateEdgeCases() {
    setError(null);
    let parsed;
    try {
      parsed = JSON.parse(sampleInputText);
    } catch {
      setError("Sample input must be valid JSON");
      return;
    }
    setSampleInput(parsed);

    setGenerating(true);
    try {
      const resp = await fetch(`${BASE}/api/generate-edge-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_input: parsed }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(describeError(data, "Could not generate edge cases"));
        return;
      }
      setCases(data.cases);
      const defaults = {};
      data.cases.forEach((c) => (defaults[c.label] = true));
      setSelected(defaults);
      setExpectOverrides({});
      // Custom cases were checked against the previous sample, so drop them.
      setCustomCases([]);
      setCustomMessage(null);
    } catch (err) {
      setError(networkError(err));
    } finally {
      setGenerating(false);
    }
  }

  // Generated cases plus the user's own, shown together in section 3.
  const allCases = [
    ...cases,
    ...customCases.map((c) => ({ ...c, category: "custom", isCustom: true })),
  ];

  function toggleCase(label) {
    setSelected((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function setAllCases(value) {
    const next = {};
    allCases.forEach((c) => (next[c.label] = value));
    setSelected(next);
  }

  function toggleCategory(category) {
    const inCategory = allCases.filter((c) => c.category === category);
    const allOn = inCategory.every((c) => selected[c.label]);
    setSelected((prev) => {
      const next = { ...prev };
      inCategory.forEach((c) => (next[c.label] = !allOn));
      return next;
    });
  }

  async function validateCustomCase() {
    setCustomMessage(null);
    const label = customLabel.trim();
    let payload;
    try {
      payload = JSON.parse(customPayloadText);
    } catch (err) {
      setCustomMessage({ ok: false, text: `Payload is not valid JSON: ${err.message}` });
      return;
    }
    if (customCases.some((c) => c.label === label)) {
      setCustomMessage({ ok: false, text: `You already added a case called '${label}'` });
      return;
    }
    let resp, result;
    try {
      resp = await fetch(`${BASE}/api/validate-custom-case`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_input: sampleInput, label, payload }),
      });
      result = await resp.json();
    } catch (err) {
      setCustomMessage({ ok: false, text: networkError(err) });
      return;
    }
    if (!resp.ok || !result.valid) {
      setCustomMessage({ ok: false, text: result.reason || result.error || "Not a valid case" });
      return;
    }
    setCustomCases((prev) => [
      ...prev,
      { label, payload, description: result.description, classified_as: result.category, expect: customExpect },
    ]);
    setSelected((prev) => ({ ...prev, [label]: true }));
    setCustomMessage({ ok: true, text: `Added '${label}' (${result.category}): ${result.description}` });
    setCustomLabel("");
    setCustomPayloadText("");
  }

  // The expected answer of a case after any override.
  function expectOf(c) {
    return c.isCustom ? c.expect : expectOverrides[c.label] || c.expect;
  }

  function toggleExpect(c) {
    const next = expectOf(c) === "accept" ? "reject" : "accept";
    if (c.isCustom) {
      setCustomCases((prev) => prev.map((x) => (x.label === c.label ? { ...x, expect: next } : x)));
      return;
    }
    setExpectOverrides((prev) => {
      const copy = { ...prev };
      if (next === c.expect) delete copy[c.label];
      else copy[c.label] = next;
      return copy;
    });
  }

  function removeCustomCase(label) {
    setCustomCases((prev) => prev.filter((c) => c.label !== label));
    setSelected((prev) => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
  }

  const selectedCount = allCases.filter((c) => selected[c.label]).length;
  const caseCategories = [...new Set(allCases.map((c) => c.category))];

  // The fields commit on blur/Enter; clamp once more here so the start
  // requests always carry whole numbers inside the allowed ranges.
  function runSettings() {
    return {
      users: clampInt(testUsers, LIMITS.users),
      spawnRate: clampInt(testSpawnRate, LIMITS.spawnRate),
      duration: clampInt(testDuration, LIMITS.duration),
      repeat: clampInt(testRepeat, LIMITS.repeat),
    };
  }

  // Extra start-request fields for a capacity run (none for a fixed run).
  function modeFields() {
    if (runMode !== "capacity") return {};
    return {
      mode: "capacity",
      spawn_rate: capPlan.spawn,
      capacity: {
        start_users: capPlan.start,
        step_users: capPlan.step,
        step_duration_seconds: capPlan.stepSeconds,
        max_users: capPlan.max,
        early_stop: capPlan.earlyStop,
      },
    };
  }

  // Expected length of the run, for the progress bar.
  function expectedSeconds(settings) {
    if (runMode === "capacity") return capacitySteps(capPlan.start, capPlan.step, capPlan.max).length * capPlan.stepSeconds;
    return settings.duration * settings.repeat;
  }

  async function confirmAndStart() {
    if (testRunning) return;
    setError(null);
    setBusyNotice(null);
    // Generated cases go by label; custom cases are sent in full so the
    // backend can re-validate them.
    const selectedLabels = cases.filter((c) => selected[c.label]).map((c) => c.label);
    const selectedCustom = customCases
      .filter((c) => selected[c.label])
      .map((c) => ({ label: c.label, payload: c.payload, expect: c.expect }));
    if (selectedLabels.length + selectedCustom.length === 0) {
      setError("Select at least one edge case");
      return;
    }
    if (targetChanged) {
      setError(TARGET_CHANGED_MESSAGE);
      return;
    }

    setStartingApiTest(true);
    try {
      const confirmResp = await fetch(`${BASE}/api/confirm-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sample_input: sampleInput,
          selected_labels: selectedLabels,
          custom_cases: selectedCustom,
          expectations: expectOverrides,
        }),
      });
      const confirmData = await confirmResp.json();
      if (!confirmResp.ok) {
        setError(describeError(confirmData, "Could not confirm the selected cases"));
        return;
      }

      const settings = runSettings();
      const startResp = await fetch(`${BASE}/api/start-load-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          headers: headersObject(requestHeaders),
          i_own_target: ownTarget,
          slo: sloPayload(sloEnabled, sloValues),
          confirmed_cases: confirmData.confirmed_cases,
          users: settings.users,
          spawn_rate: settings.spawnRate,
          duration_seconds: settings.duration,
          repeat: settings.repeat,
          ...modeFields(),
        }),
      });
      const startData = await startResp.json();
      if (startResp.status === 429) {
        setBusyNotice(startData.error || "another load test is still running. Try again when it has finished.");
        return;
      }
      if (!startResp.ok) {
        setError(describeError(startData, "Could not start the load test"));
        return;
      }

      setWebsitePathsUsed(null);
      setJobId(startData.job_id);
      setRunStartedAt(Date.now());
      // A series runs back to back, so the estimate covers every repeat.
      setRunDuration(expectedSeconds(settings));
      setElapsedSec(0);
      setJobStatus("queued");
      setJobResult(null);
      setPollState(null);
      setStopState(null);
      pollStatus(startData.job_id);
    } catch (err) {
      setError(networkError(err));
    } finally {
      setStartingApiTest(false);
    }
  }

  async function startWebsiteLoadTest() {
    if (testRunning) return;
    setError(null);
    setBusyNotice(null);
    if (targetChanged) {
      setError(TARGET_CHANGED_MESSAGE);
      return;
    }
    setStartingWebsiteTest(true);
    const settings = runSettings();
    try {
      const resp = await fetch(`${BASE}/api/start-website-load-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          headers: headersObject(requestHeaders),
          i_own_target: ownTarget,
          slo: sloPayload(sloEnabled, sloValues),
          sitemap_raw: sitemapRaw,
          users: settings.users,
          spawn_rate: settings.spawnRate,
          duration_seconds: settings.duration,
          repeat: settings.repeat,
          ...modeFields(),
        }),
      });
      const data = await resp.json();
      if (resp.status === 429) {
        setBusyNotice(data.error || "another load test is still running. Try again when it has finished.");
        return;
      }
      if (!resp.ok) {
        setError(data.error || "Could not start website load test");
        return;
      }

      setWebsitePathsUsed(data.paths_used || []);
      setJobId(data.job_id);
      setRunStartedAt(Date.now());
      // A series runs back to back, so the estimate covers every repeat.
      setRunDuration(expectedSeconds(settings));
      setElapsedSec(0);
      setJobStatus("queued");
      setJobResult(null);
      setPollState(null);
      setStopState(null);
      pollStatus(data.job_id);
    } catch (err) {
      setError(networkError(err));
    } finally {
      setStartingWebsiteTest(false);
    }
  }

  function pollStatus(id) {
    let failures = 0;
    const poll = async () => {
      let data;
      try {
        const resp = await fetch(`${BASE}/api/load-test-status/${id}`);
        data = await resp.json();
      } catch {
        // Keep the same 2-second rhythm; give up after MAX_POLL_FAILURES.
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          setPollState("lost");
          return;
        }
        setPollState("retrying");
        setTimeout(poll, 2000);
        return;
      }
      failures = 0;
      setPollState(null);
      setJobStatus(data.status);

      if (["completed", "failed", "timeout", "cancelled", "interrupted"].includes(data.status)) {
        setJobResult(data);
        refreshJobHistory();
        return;
      }
      setTimeout(poll, 2000);
    };
    poll();
  }

  // "Check again" after polling gave up: resume with a fresh failure count.
  function checkStatusAgain() {
    setPollState("retrying");
    pollStatus(jobId);
  }

  async function stopTest() {
    setStopState("stopping");
    try {
      const resp = await fetch(`${BASE}/api/cancel/${jobId}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        setError(describeError(data, "Could not stop the test"));
        setStopState(null);
      }
      // On success pollStatus() sees "cancelled" once Locust has exited.
    } catch (err) {
      setError(networkError(err));
      setStopState(null);
    }
  }

  function toggleCompareId(id) {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  }

  async function runComparison() {
    setError(null);
    setCompareResult(null);
    if (compareIds.length < 2 || compareIds.length > 4) {
      setError("Pick 2 to 4 runs to compare");
      return;
    }
    setComparing(true);
    try {
      const resp = await fetch(`${BASE}/api/compare-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: compareIds }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Could not compare those runs");
        return;
      }
      setCompareResult(data);
    } catch (err) {
      setError(networkError(err));
    } finally {
      setComparing(false);
    }
  }

  // Guards against starting a second job while one is polling: two concurrent
  // pollStatus loops would both write jobStatus/jobResult and clobber each other.
  // Released early only when polling gave up ("lost"): the run may still be
  // going, but the app can no longer tell.
  const testRunning = (jobStatus === "queued" || jobStatus === "running") && pollState !== "lost";
  // The URL field was edited after the last analysis.
  const targetChanged = analyzedUrl !== null && url !== analyzedUrl;

  // ---- Presentation ------------------------------------------------------

  // Workflow steps for the rail and the step panels. The active step is the
  // first one that can be done now but isn't done yet.
  const stepDefs = [
    { n: 1, label: "Target", complete: (isApi || isWebsite) && !targetChanged, available: true, skipped: false },
    { n: 2, label: "Sample request", complete: cases.length > 0, available: isApi, skipped: isWebsite },
    { n: 3, label: "Cases and load", complete: jobId != null, available: cases.length > 0, skipped: isWebsite },
    { n: 4, label: "Run and results", complete: jobResult != null, available: jobId != null, skipped: false },
    { n: 5, label: "Compare runs", complete: compareResult != null, available: jobHistory.length > 0, skipped: false },
  ];
  const activeStep = stepDefs.find((s) => s.available && !s.complete && !s.skipped)?.n;
  const steps = stepDefs.map((s) => ({
    ...s,
    targetId: `step-${s.n}`,
    state: s.skipped ? "skipped" : s.complete ? "done" : s.n === activeStep ? "active" : "pending",
  }));
  const stateOf = (n) => steps[n - 1].state;

  const statusLook = {
    queued: { color: colors.accent, text: "Queued" },
    running: { color: colors.accent, text: "Running" },
    completed: { color: colors.text, text: "Completed" },
    failed: { color: colors.danger, text: "Failed" },
    timeout: { color: colors.danger, text: "Timed out" },
    cancelled: { color: colors.warning, text: "Cancelled" },
    interrupted: { color: colors.warning, text: "Interrupted" },
  }[jobStatus] || { color: colors.textMuted, text: jobStatus || "" };

  // Load settings shared by the API flow (step 3) and the website flow (step 1).
  const sloNow = sloPayload(sloEnabled, sloValues);
  const sloReady = !!sloNow && ["p95_ms", "avg_ms", "max_server_error_rate_pct", "max_unexpected_outcome_rate_pct"]
    .some((k) => sloNow[k] != null);
  const capacityTooLong =
    capacitySteps(capPlan.start, capPlan.step, capPlan.max).length * capPlan.stepSeconds > CAPACITY_LIMITS.totalSeconds;
  // A capacity run needs an SLO to judge its steps and must fit in 300 s.
  const capacityBlocked = runMode === "capacity" && (!sloReady || capacityTooLong);
  const loadSettings = (
    <>
      <RunModeToggle mode={runMode} onChange={setRunMode} />
      {runMode === "fixed" ? (
        <LoadTestConfig
          users={testUsers}
          spawnRate={testSpawnRate}
          duration={testDuration}
          onUsersChange={setTestUsers}
          onSpawnRateChange={setTestSpawnRate}
          onDurationChange={setTestDuration}
          repeat={testRepeat}
          onRepeatChange={setTestRepeat}
        />
      ) : (
        <CapacityConfig
          plan={capPlan}
          spawnRate={capPlan.spawn}
          onPlanChange={setCapPlan}
          onSpawnRateChange={(spawn) => setCapPlan((p) => ({ ...p, spawn }))}
          sloReady={sloReady}
        />
      )}
      <SloConfig
        enabled={sloEnabled}
        values={sloValues}
        onEnabledChange={setSloEnabled}
        onValuesChange={setSloValues}
      />
    </>
  );

  const historyColumns = "22px 48px 170px minmax(140px, 1fr) 60px 90px 56px 90px";

  return (
    <div style={{ fontFamily: font.sans, color: colors.text }}>
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="app-frame">
        <AppHeader apiBase={BASE} />

        <div className="app-shell">
          <StepRail steps={steps} />

          <main id="main" tabIndex={-1} className="app-main">
            {error && (
              <div
                ref={errorRef}
                role="alert"
                tabIndex={-1}
                style={{
                  scrollMarginTop: 72,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: space.sm,
                  background: colors.dangerSoft,
                  border: `1px solid ${colors.danger}`,
                  color: colors.text,
                  padding: `${space.sm}px ${space.md}px`,
                  borderRadius: radius.md,
                  marginBottom: space.md,
                  fontSize: type.body,
                }}
              >
                <span aria-hidden="true" style={{ color: colors.danger, fontWeight: 600 }}>!</span>
                <span style={{ flex: 1, wordBreak: "break-word" }}>{error}</span>
                <button
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                  className="btn-bare"
                  style={iconButtonStyle}
                >
                  ×
                </button>
              </div>
            )}

            <Section
              id="step-1"
              step={1}
              title="Target"
              description="Check that the URL is reachable and whether it is an API or a website."
              state={stateOf(1)}
            >
              <label htmlFor="target-url" style={labelStyle}>Target URL</label>
              <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
                <input
                  id="target-url"
                  style={{ ...inputStyle, flex: "1 1 320px", width: "auto" }}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !analyzing) analyzeUrl();
                  }}
                  placeholder="https://example.com/api/endpoint"
                />
                <button onClick={analyzeUrl} className="btn btn-primary" disabled={analyzing}>
                  {analyzing ? "Analyzing…" : "Analyze"}
                </button>
              </div>

              {analyzeResult && (
                <AnalyzeSummary
                  data={analyzeResult}
                  showRaw={showRawAnalyze}
                  onToggleRaw={() => setShowRawAnalyze((v) => !v)}
                />
              )}

              {targetChanged && (
                <p role="status" style={{ margin: `${space.sm}px 0 0`, fontSize: type.meta, color: colors.warning }}>
                  {TARGET_CHANGED_MESSAGE}
                </p>
              )}

              {isWebsite && !targetChanged && (
                <>
                  {loadSettings}
                  <WebsiteLoadTestSection
                    sitemapRaw={sitemapRaw}
                    onStart={startWebsiteLoadTest}
                    starting={startingWebsiteTest}
                    testRunning={testRunning}
                    targetUrl={analyzedUrl}
                    ownTarget={ownTarget}
                    onOwnTargetChange={setOwnTarget}
                    blocked={capacityBlocked}
                  />
                  {busyNotice && (
                    <p role="status" style={{ margin: `${space.sm}px 0 0`, fontSize: type.body, color: colors.warning }}>
                      Server busy: {busyNotice}
                    </p>
                  )}
                </>
              )}
            </Section>

            {isApi && (
              <Section
                id="step-2"
                step={2}
                title="Sample request"
                description="Paste a JSON body the API accepts. Edge cases are generated from it."
                state={stateOf(2)}
              >
                <label htmlFor="sample-input" style={labelStyle}>Sample JSON body</label>
                <textarea
                  id="sample-input"
                  rows={4}
                  style={{ ...inputStyle, resize: "vertical" }}
                  value={sampleInputText}
                  onChange={(e) => setSampleInputText(e.target.value)}
                />
                <button
                  onClick={generateEdgeCases}
                  className="btn btn-primary"
                  style={{ marginTop: space.sm }}
                  disabled={generating}
                >
                  {generating ? "Generating…" : "Generate edge cases"}
                </button>
                <RequestHeadersEditor rows={requestHeaders} onChange={setRequestHeaders} />
              </Section>
            )}

            {cases.length > 0 && (
              <Section
                id="step-3"
                step={3}
                title="Cases and load"
                description="Choose which cases to send, how many users to simulate, and for how long."
                state={stateOf(3)}
              >
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginBottom: space.sm }}>
                  <button onClick={() => setAllCases(true)} className="btn btn-secondary btn-small">
                    Select all
                  </button>
                  <button onClick={() => setAllCases(false)} className="btn btn-secondary btn-small">
                    Select none
                  </button>
                  <span style={{ marginLeft: "auto", fontSize: type.meta, color: colors.textMuted, fontFamily: font.mono }}>
                    {selectedCount} of {allCases.length} selected
                  </span>
                </div>

                <div
                  style={{
                    maxHeight: 380,
                    overflowY: "auto",
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.md,
                    background: colors.inset,
                    isolation: "isolate",
                  }}
                >
                  {caseCategories.map((cat) => {
                    const inCategory = allCases.filter((c) => c.category === cat);
                    const onCount = inCategory.filter((c) => selected[c.label]).length;
                    const allOn = onCount === inCategory.length;
                    const someOn = onCount > 0 && !allOn;
                    return (
                      <div key={cat} role="group" aria-label={CASE_CATEGORY_LABELS[cat] || cat}>
                        <label
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: z.local,
                            display: "flex",
                            alignItems: "center",
                            gap: space.sm,
                            padding: `${space.sm}px ${space.md}px`,
                            background: colors.surfaceRaised,
                            borderBottom: `1px solid ${colors.borderSubtle}`,
                            cursor: "pointer",
                          }}
                          title={`${allOn ? "Deselect" : "Select"} every case in "${CASE_CATEGORY_LABELS[cat] || cat}"`}
                        >
                          <input
                            type="checkbox"
                            checked={allOn}
                            ref={(el) => {
                              if (el) el.indeterminate = someOn;
                            }}
                            onChange={() => toggleCategory(cat)}
                          />
                          <span style={{ fontWeight: 600, fontSize: type.body }}>{CASE_CATEGORY_LABELS[cat] || cat}</span>
                          <span style={{ fontFamily: font.mono, fontSize: type.meta, color: colors.textMuted }}>
                            {onCount}/{inCategory.length}
                          </span>
                        </label>
                        {inCategory.map((c) => (
                          <label
                            key={c.label}
                            className="row-interactive"
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: space.sm,
                              padding: `${space.xs}px ${space.md}px ${space.xs}px ${space.xxl}px`,
                              fontSize: type.body,
                              cursor: "pointer",
                              borderBottom: `1px solid ${colors.borderSubtle}`,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={!!selected[c.label]}
                              onChange={() => toggleCase(c.label)}
                              style={{ transform: "translateY(2px)" }}
                            />
                            <span style={{ flex: 1, color: colors.text }}>{c.description}</span>
                            <span style={{ fontFamily: font.mono, fontSize: type.meta, color: colors.textFaint }}>
                              {c.label}
                            </span>
                            {c.expect && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  toggleExpect(c);
                                }}
                                className="toggle"
                                aria-pressed={expectOf(c) === "accept"}
                                aria-label={`Expected answer for ${c.label}: ${expectOf(c) === "accept" ? "2xx success" : "4xx rejection"}. Click to switch.`}
                                title={expectOf(c) === "accept"
                                  ? "Valid input: a 2xx answer is correct. Click to expect a 4xx rejection."
                                  : "Invalid input: a 4xx rejection is correct. Click to expect a 2xx success (e.g. an optional field)."}
                                style={{ fontFamily: font.mono, minWidth: 92 }}
                              >
                                expects {expectOf(c) === "accept" ? "2xx" : "4xx"}
                              </button>
                            )}
                            {c.isCustom && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  removeCustomCase(c.label);
                                }}
                                aria-label={`Remove custom case ${c.label}`}
                                className="btn-bare"
                                style={iconButtonStyle}
                              >
                                ×
                              </button>
                            )}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>

                <details style={{ marginTop: space.md }}>
                  <summary style={{ cursor: "pointer", fontSize: type.body, color: colors.accent }}>
                    Add your own case
                  </summary>
                  <div style={{ marginTop: space.sm, display: "grid", gap: space.sm }}>
                    <p style={{ fontSize: type.meta, color: colors.textMuted, margin: 0 }}>
                      Give it a label (lowercase letters, digits, _) and the JSON body to send. It must
                      differ from the sample request.
                    </p>
                    <div>
                      <label htmlFor="custom-label" style={labelStyle}>Label</label>
                      <input
                        id="custom-label"
                        style={inputStyle}
                        placeholder="admin_user"
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="custom-payload" style={labelStyle}>JSON body</label>
                      <textarea
                        id="custom-payload"
                        rows={3}
                        style={{ ...inputStyle, resize: "vertical" }}
                        placeholder='{"username": "admin", "password": "demo123", "expiresInMins": 30}'
                        value={customPayloadText}
                        onChange={(e) => setCustomPayloadText(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="custom-expect" style={labelStyle}>Expected answer</label>
                      <select
                        id="custom-expect"
                        style={{ ...inputStyle, width: "auto" }}
                        value={customExpect}
                        onChange={(e) => setCustomExpect(e.target.value)}
                      >
                        <option value="reject">Reject it (4xx) — invalid input</option>
                        <option value="accept">Accept it (2xx) — valid input</option>
                      </select>
                    </div>
                    <div>
                      <button onClick={validateCustomCase} className="btn btn-secondary">
                        Validate and add
                      </button>
                    </div>
                    {customMessage && (
                      <div
                        role="status"
                        style={{ fontSize: type.meta, color: customMessage.ok ? colors.success : colors.danger }}
                      >
                        {customMessage.text}
                      </div>
                    )}
                  </div>
                </details>

                {loadSettings}

                <OwnershipCheck id="own-target-api" checked={ownTarget} onChange={setOwnTarget} />
                {targetChanged ? (
                  <p style={{ margin: `${space.sm}px 0 0`, fontSize: type.meta, color: colors.warning }}>
                    {TARGET_CHANGED_MESSAGE}
                  </p>
                ) : (
                  <p style={{ margin: `${space.sm}px 0 0`, fontSize: type.meta, color: colors.textMuted }}>
                    Sends {selectedCount} case{selectedCount === 1 ? "" : "s"} to{" "}
                    <span style={{ fontFamily: font.mono, color: colors.text, wordBreak: "break-all" }}>{analyzedUrl}</span>
                  </p>
                )}
                <button
                  onClick={confirmAndStart}
                  className="btn btn-primary"
                  style={{ marginTop: space.sm }}
                  disabled={testRunning || startingApiTest || targetChanged || !ownTarget || capacityBlocked}
                >
                  {testRunning ? "Test in progress…" : startingApiTest ? "Starting…" : "Confirm selection and start load test"}
                </button>
                {busyNotice && (
                  <p role="status" style={{ margin: `${space.sm}px 0 0`, fontSize: type.body, color: colors.warning }}>
                    Server busy: {busyNotice}
                  </p>
                )}
              </Section>
            )}

            {jobId && (
              <Section
                id="step-4"
                step={4}
                title="Run and results"
                description="Live progress, then results, failure reasons and the comparison with your baseline."
                state={stateOf(4)}
              >
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.md }}>
                  <span style={{ fontSize: type.meta, color: colors.textMuted }}>
                    Run <span style={{ fontFamily: font.mono, color: colors.text }}>{jobId}</span>
                  </span>
                  {jobResult?.child_jobs?.length > 1 && (
                    <span
                      title="Runs above 50 users run as several Locust processes in parallel on the same host (one per 50 users, at most 10). Their results are merged; the merged p95 is an approximation."
                      style={{
                        border: `1px solid ${colors.accent}`,
                        color: colors.accent,
                        fontFamily: font.mono,
                        fontSize: type.meta,
                        padding: `0 ${space.sm}px`, lineHeight: "20px",
                        borderRadius: radius.sm,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {jobResult.child_jobs.length} parallel Locust processes
                    </span>
                  )}
                  <span
                    role="status"
                    aria-live="polite"
                    style={{
                      marginLeft: "auto",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: space.sm,
                      color: statusLook.color,
                      fontWeight: 600,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusLook.color }} />
                    {statusLook.text}
                  </span>
                </div>

                {["queued", "running"].includes(jobStatus) && runDuration != null && (
                  <div style={{ marginTop: space.md }}>
                    <div
                      role="progressbar"
                      aria-label="Estimated progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(Math.min((elapsedSec / runDuration) * 100, 100))}
                      style={{
                        height: 4,
                        background: colors.track,
                        borderRadius: radius.pill,
                        overflow: "hidden",
                        marginBottom: space.xs,
                      }}
                    >
                      <div
                        className="progress-fill"
                        style={{ transform: `scaleX(${Math.min(elapsedSec / runDuration, 1)})` }}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.md }}>
                      <div style={{ flex: 1, minWidth: 240, fontSize: type.meta, color: colors.textMuted, fontFamily: font.mono }}>
                        {elapsedSec}s elapsed of about {runDuration}s. This is an estimate: ramp-up and
                        teardown add a few seconds.
                      </div>
                      {testRunning && stopState === null && (
                        <button onClick={() => setStopState("confirm")} className="btn btn-secondary btn-small">
                          Stop test
                        </button>
                      )}
                      {testRunning && stopState === "confirm" && (
                        <span role="group" aria-label="Confirm stopping the test" style={{ display: "inline-flex", alignItems: "center", gap: space.sm }}>
                          <span style={{ fontSize: type.meta, color: colors.text }}>Stop now? Results so far are kept.</span>
                          <button onClick={stopTest} className="btn btn-primary btn-small">Yes, stop</button>
                          <button onClick={() => setStopState(null)} className="btn btn-secondary btn-small">Keep running</button>
                        </span>
                      )}
                      {testRunning && stopState === "stopping" && (
                        <span style={{ fontSize: type.meta, color: colors.textMuted }}>Stopping…</span>
                      )}
                    </div>
                  </div>
                )}

                {pollState === "retrying" && (
                  <p role="status" style={{ margin: `${space.sm}px 0 0`, fontSize: type.meta, color: colors.warning }}>
                    Lost connection to the backend — retrying
                  </p>
                )}
                {pollState === "lost" && (
                  <div role="alert" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.md, marginTop: space.sm }}>
                    <span style={{ fontSize: type.body, color: colors.danger }}>
                      Status unknown — the backend is unreachable
                    </span>
                    <button onClick={checkStatusAgain} className="btn btn-secondary btn-small">
                      Check again
                    </button>
                  </div>
                )}

                {websitePathsUsed && (
                  <p style={{ fontSize: type.meta, color: colors.textMuted, fontFamily: font.mono, marginBottom: 0 }}>
                    Pages tested: {websitePathsUsed.join(", ")}
                  </p>
                )}
                {jobResult?.header_names?.length > 0 && (
                  <p style={{ fontSize: type.meta, color: colors.textMuted, marginBottom: 0 }}>
                    Sent with request headers:{" "}
                    <span style={{ fontFamily: font.mono, color: colors.text }}>{jobResult.header_names.join(", ")}</span>{" "}
                    (values hidden)
                  </p>
                )}

                {jobResult?.series_id && <SeriesSummary data={jobResult} />}
                {jobResult && !jobResult.series_id && (
                  <JobResultSummary
                    data={jobResult}
                    showRaw={showRawJob}
                    onToggleRaw={() => setShowRawJob((v) => !v)}
                    regressionInfo={regressionInfo}
                  />
                )}
                {jobResult && !jobResult.series_id && (
                  <RunActions
                    run={jobResult}
                    regressionInfo={regressionInfo}
                    onMarkBaseline={markAsBaseline}
                    markingBaseline={markingBaseline}
                  />
                )}
              </Section>
            )}

            {jobHistory.length > 0 && (
              <Section
                id="step-5"
                step={5}
                title="Compare runs"
                description="Tick 2 to 4 past runs. The first one you tick is the reference, Run 1."
                state={stateOf(5)}
              >
                <div
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.md,
                    background: colors.inset,
                    overflowX: "auto",
                  }}
                >
                  <div style={{ minWidth: 680 }}>
                    <div
                      aria-hidden="true"
                      style={{
                        display: "grid",
                        gridTemplateColumns: historyColumns,
                        gap: space.sm,
                        padding: `${space.sm}px ${space.md}px`,
                        fontFamily: font.mono,
                        fontSize: type.meta,
                        color: colors.textMuted,
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      <span />
                      <span>Order</span>
                      <span>Started</span>
                      <span>Target</span>
                      <span>Users</span>
                      <span>Status</span>
                      <span>SLO</span>
                      <span>Baseline</span>
                    </div>
                    <div style={{ maxHeight: 240, overflowY: "auto" }}>
                      {jobHistory.map((j) => {
                        const position = compareIds.indexOf(j.id);
                        const checked = position !== -1;
                        const full = !checked && compareIds.length >= 4;
                        return (
                          <label
                            key={j.id}
                            className="row-interactive"
                            style={{
                              display: "grid",
                              gridTemplateColumns: historyColumns,
                              gap: space.sm,
                              alignItems: "center",
                              padding: `${space.xs}px ${space.md}px`,
                              fontFamily: font.mono,
                              fontSize: type.meta,
                              color: full ? colors.textFaint : colors.text,
                              background: checked ? colors.accentSoft : undefined,
                              borderBottom: `1px solid ${colors.borderSubtle}`,
                              cursor: full ? "not-allowed" : "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              value={j.id}
                              checked={checked}
                              disabled={full}
                              onChange={() => toggleCompareId(j.id)}
                              aria-label={`Compare run started ${formatTime(j.created_at)}, ${j.users} users, ${j.target_url}, ${j.status}${j.is_baseline ? ", baseline" : ""}`}
                            />
                            <span style={{ color: colors.accent }}>{checked ? `#${position + 1}` : ""}</span>
                            <span>{formatTime(j.created_at)}</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {j.target_url}
                            </span>
                            <span>{j.users}</span>
                            <span style={{ color: ["cancelled", "interrupted"].includes(j.status) ? colors.warning : ["failed", "timeout"].includes(j.status) ? colors.danger : j.status === "completed" ? colors.textMuted : colors.text }}>{j.status}{j.mode === "capacity" ? " · capacity" : ""}</span>
                            <span><VerdictChip verdict={j.slo_verdict} /></span>
                            <span style={{ color: colors.accent }}>{j.is_baseline ? "★ baseline" : ""}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.md, marginTop: space.md }}>
                  <button
                    onClick={runComparison}
                    className="btn btn-primary"
                    disabled={compareIds.length < 2 || comparing}
                  >
                    {comparing ? "Comparing…" : "Compare"}
                  </button>
                  <span style={{ fontSize: type.meta, color: colors.textMuted }}>
                    {compareIds.length} selected
                    {compareIds.length < 2 && ". Select at least 2 runs to compare."}
                    {compareIds.length === 4 && ". That's the maximum of 4."}
                  </span>
                  <button onClick={refreshJobHistory} className="btn-link" style={{ marginLeft: "auto" }}>
                    Refresh list
                  </button>
                </div>

                {compareResult?.jobs && (
                  <CompareView jobs={compareResult.jobs} caseComparison={compareResult.case_comparison} />
                )}
              </Section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
