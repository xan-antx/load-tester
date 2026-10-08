import { useState, useEffect } from "react";
import Section, {
  btnStyle, secondaryBtnStyle, linkBtnStyle, inputStyle, labelStyle, withDisabled,
} from "./components/Section";
import AnalyzeSummary from "./components/AnalyzeSummary";
import JobResultSummary from "./components/JobResultSummary";
import CompareView from "./components/CompareView";
import WebsiteLoadTestSection from "./components/WebsiteLoadTestSection";
import LoadTestConfig, { LIMITS, clampInt } from "./components/LoadTestConfig";
import RunActions from "./components/RunActions";
import AppHeader from "./components/AppHeader";
import StepRail from "./components/StepRail";
import { colors, font, space, radius, type } from "./theme";
import { formatTime } from "./utils/formatTime";

const BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

// Section 3 groups the selectable cases under these headings.
const CASE_CATEGORY_LABELS = {
  missing_field: "Missing field",
  null_value: "Null value",
  type_mismatch: "Type mismatch",
  boundary_value: "Boundary value",
  known_attack: "Known attack",
  custom: "Your own cases",
};

export default function App() {
  const [url, setUrl] = useState("https://dummyjson.com/auth/login");
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [isApi, setIsApi] = useState(false);
  const [isWebsite, setIsWebsite] = useState(false);
  const [sitemapRaw, setSitemapRaw] = useState(null);
  const [showRawAnalyze, setShowRawAnalyze] = useState(false);

  const [sampleInputText, setSampleInputText] = useState(
    '{"username": "emilys", "password": "emilyspass", "expiresInMins": 30}'
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

  const [testUsers, setTestUsers] = useState(3);
  const [testSpawnRate, setTestSpawnRate] = useState(1);
  // 30 s by default: shorter runs give too few requests per case to compare.
  const [testDuration, setTestDuration] = useState(30);

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

  useEffect(() => {
    refreshJobHistory();
  }, []);

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
    setRegressionInfo(null);
    if (jobResult?.status === "completed" && jobId) {
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
    setAnalyzing(true);
    setAnalyzeResult(null);
    setSitemapRaw(null);
    try {
      const resp = await fetch(`${BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await resp.json();
      setAnalyzeResult(data);

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
        setError(JSON.stringify(data));
        return;
      }
      setCases(data.cases);
      const defaults = {};
      data.cases.forEach((c) => (defaults[c.label] = true));
      setSelected(defaults);
      // Custom cases were checked against the previous sample, so drop them.
      setCustomCases([]);
      setCustomMessage(null);
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
    const resp = await fetch(`${BASE}/api/validate-custom-case`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sample_input: sampleInput, label, payload }),
    });
    const result = await resp.json();
    if (!resp.ok || !result.valid) {
      setCustomMessage({ ok: false, text: result.reason || result.error || "Not a valid case" });
      return;
    }
    setCustomCases((prev) => [
      ...prev,
      { label, payload, description: result.description, classified_as: result.category },
    ]);
    setSelected((prev) => ({ ...prev, [label]: true }));
    setCustomMessage({ ok: true, text: `Added '${label}' (${result.category}): ${result.description}` });
    setCustomLabel("");
    setCustomPayloadText("");
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
    };
  }

  async function confirmAndStart() {
    if (testRunning) return;
    setError(null);
    // Generated cases go by label; custom cases are sent in full so the
    // backend can re-validate them.
    const selectedLabels = cases.filter((c) => selected[c.label]).map((c) => c.label);
    const selectedCustom = customCases
      .filter((c) => selected[c.label])
      .map((c) => ({ label: c.label, payload: c.payload }));
    if (selectedLabels.length + selectedCustom.length === 0) {
      setError("Select at least one edge case");
      return;
    }

    const confirmResp = await fetch(`${BASE}/api/confirm-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sample_input: sampleInput,
        selected_labels: selectedLabels,
        custom_cases: selectedCustom,
      }),
    });
    const confirmData = await confirmResp.json();
    if (!confirmResp.ok) {
      setError(JSON.stringify(confirmData));
      return;
    }

    const settings = runSettings();
    const startResp = await fetch(`${BASE}/api/start-load-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        confirmed_cases: confirmData.confirmed_cases,
        users: settings.users,
        spawn_rate: settings.spawnRate,
        duration_seconds: settings.duration,
      }),
    });
    const startData = await startResp.json();
    if (!startResp.ok) {
      setError(JSON.stringify(startData));
      return;
    }

    setWebsitePathsUsed(null);
    setJobId(startData.job_id);
    setRunStartedAt(Date.now());
    setRunDuration(settings.duration);
    setElapsedSec(0);
    setJobStatus("queued");
    setJobResult(null);
    pollStatus(startData.job_id);
  }

  async function startWebsiteLoadTest() {
    if (testRunning) return;
    setError(null);
    setStartingWebsiteTest(true);
    const settings = runSettings();
    try {
      const resp = await fetch(`${BASE}/api/start-website-load-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          sitemap_raw: sitemapRaw,
          users: settings.users,
          spawn_rate: settings.spawnRate,
          duration_seconds: settings.duration,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Could not start website load test");
        return;
      }

      setWebsitePathsUsed(data.paths_used || []);
      setJobId(data.job_id);
      setRunStartedAt(Date.now());
      setRunDuration(settings.duration);
      setElapsedSec(0);
      setJobStatus("queued");
      setJobResult(null);
      pollStatus(data.job_id);
    } finally {
      setStartingWebsiteTest(false);
    }
  }

  function pollStatus(id) {
    const poll = async () => {
      const resp = await fetch(`${BASE}/api/load-test-status/${id}`);
      const data = await resp.json();
      setJobStatus(data.status);

      if (["completed", "failed", "timeout"].includes(data.status)) {
        setJobResult(data);
        refreshJobHistory();
        return;
      }
      setTimeout(poll, 2000);
    };
    poll();
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
    } finally {
      setComparing(false);
    }
  }

  // Guards against starting a second job while one is polling: two concurrent
  // pollStatus loops would both write jobStatus/jobResult and clobber each other.
  const testRunning = jobStatus === "queued" || jobStatus === "running";

  // ---- Presentation ------------------------------------------------------

  // Workflow steps for the rail and the step panels. The active step is the
  // first one that can be done now but isn't done yet.
  const stepDefs = [
    { n: 1, label: "Target", complete: analyzeResult != null, available: true, skipped: false },
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

  const smallBtnStyle = {
    ...secondaryBtnStyle,
    marginTop: 0,
    padding: "4px 10px",
    fontSize: type.small,
  };

  const statusLook = {
    queued: { color: colors.accent, text: "Queued", live: true },
    running: { color: colors.accent, text: "Running", live: true },
    completed: { color: colors.text, text: "Completed", live: false },
    failed: { color: colors.danger, text: "Failed", live: false },
    timeout: { color: colors.danger, text: "Timed out", live: false },
  }[jobStatus] || { color: colors.textMuted, text: jobStatus || "", live: false };

  const historyColumns = "22px 48px 170px minmax(140px, 1fr) 60px 90px 90px";

  return (
    <div style={{ fontFamily: font.sans, color: colors.text }}>
      <div className="app-frame">
        <AppHeader apiBase={BASE} />

        <div className="app-shell">
          <StepRail steps={steps} />

          <main className="app-main">
            {error && (
              <div
                role="alert"
                style={{
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
                  style={{
                    background: "transparent",
                    border: "none",
                    color: colors.textMuted,
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                    padding: 0,
                  }}
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
                <button onClick={analyzeUrl} style={{ ...withDisabled(btnStyle, analyzing), marginTop: 0 }} disabled={analyzing}>
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

              {isWebsite && (
                <>
                  <LoadTestConfig
                    users={testUsers}
                    spawnRate={testSpawnRate}
                    duration={testDuration}
                    onUsersChange={setTestUsers}
                    onSpawnRateChange={setTestSpawnRate}
                    onDurationChange={setTestDuration}
                  />
                  <WebsiteLoadTestSection
                    sitemapRaw={sitemapRaw}
                    onStart={startWebsiteLoadTest}
                    starting={startingWebsiteTest}
                    testRunning={testRunning}
                  />
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
                <button onClick={generateEdgeCases} style={withDisabled(btnStyle, generating)} disabled={generating}>
                  {generating ? "Generating…" : "Generate edge cases"}
                </button>
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
                  <button onClick={() => setAllCases(true)} style={smallBtnStyle}>
                    Select all
                  </button>
                  <button onClick={() => setAllCases(false)} style={smallBtnStyle}>
                    Select none
                  </button>
                  <span style={{ marginLeft: "auto", fontSize: type.label, color: colors.textMuted, fontFamily: font.mono }}>
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
                            zIndex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: space.sm,
                            padding: `6px ${space.md}px`,
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
                          <span style={{ fontFamily: font.mono, fontSize: type.label, color: colors.textMuted }}>
                            {onCount}/{inCategory.length}
                          </span>
                        </label>
                        {inCategory.map((c) => (
                          <label
                            key={c.label}
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: space.sm,
                              padding: `5px ${space.md}px 5px ${space.xl + space.sm}px`,
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
                            <span style={{ fontFamily: font.mono, fontSize: 11.5, color: colors.textFaint }}>
                              {c.label}
                            </span>
                            {c.isCustom && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  removeCustomCase(c.label);
                                }}
                                aria-label={`Remove custom case ${c.label}`}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: colors.textMuted,
                                  cursor: "pointer",
                                  fontSize: 15,
                                  padding: "0 2px",
                                }}
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
                    <p style={{ fontSize: type.small, color: colors.textMuted, margin: 0 }}>
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
                      <button onClick={validateCustomCase} style={{ ...secondaryBtnStyle, marginTop: 0 }}>
                        Validate and add
                      </button>
                    </div>
                    {customMessage && (
                      <div
                        role="status"
                        style={{ fontSize: type.small, color: customMessage.ok ? colors.success : colors.danger }}
                      >
                        {customMessage.text}
                      </div>
                    )}
                  </div>
                </details>

                <LoadTestConfig
                  users={testUsers}
                  spawnRate={testSpawnRate}
                  duration={testDuration}
                  onUsersChange={setTestUsers}
                  onSpawnRateChange={setTestSpawnRate}
                  onDurationChange={setTestDuration}
                />

                <button onClick={confirmAndStart} style={withDisabled(btnStyle, testRunning)} disabled={testRunning}>
                  {testRunning ? "Test in progress…" : "Confirm selection and start load test"}
                </button>
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
                  <span style={{ fontSize: type.small, color: colors.textMuted }}>
                    Run <span style={{ fontFamily: font.mono, color: colors.text }}>{jobId}</span>
                  </span>
                  {jobResult?.child_jobs?.length > 1 && (
                    <span
                      title="Runs above 50 users are split across workers and their results merged."
                      style={{
                        border: `1px solid ${colors.accent}`,
                        color: colors.accent,
                        fontFamily: font.mono,
                        fontSize: 11.5,
                        padding: "1px 8px",
                        borderRadius: radius.sm,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Split across {jobResult.child_jobs.length} workers
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
                    <span
                      className={statusLook.live ? "pulse" : undefined}
                      style={{ width: 8, height: 8, borderRadius: "50%", background: statusLook.color }}
                    />
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
                        style={{
                          width: `${Math.min((elapsedSec / runDuration) * 100, 100)}%`,
                          height: "100%",
                          background: colors.accent,
                          transition: "width 0.5s linear",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: type.label, color: colors.textMuted, fontFamily: font.mono }}>
                      {elapsedSec}s elapsed of about {runDuration}s. This is an estimate: ramp-up and
                      teardown add a few seconds.
                    </div>
                  </div>
                )}

                {websitePathsUsed && (
                  <p style={{ fontSize: type.small, color: colors.textMuted, fontFamily: font.mono, marginBottom: 0 }}>
                    Pages tested: {websitePathsUsed.join(", ")}
                  </p>
                )}

                {jobResult && (
                  <JobResultSummary
                    data={jobResult}
                    showRaw={showRawJob}
                    onToggleRaw={() => setShowRawJob((v) => !v)}
                    regressionInfo={regressionInfo}
                  />
                )}
                {jobResult && (
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
                  <div style={{ minWidth: 620 }}>
                    <div
                      aria-hidden="true"
                      style={{
                        display: "grid",
                        gridTemplateColumns: historyColumns,
                        gap: space.sm,
                        padding: `6px ${space.md}px`,
                        fontFamily: font.mono,
                        fontSize: 11.5,
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
                            style={{
                              display: "grid",
                              gridTemplateColumns: historyColumns,
                              gap: space.sm,
                              alignItems: "center",
                              padding: `5px ${space.md}px`,
                              fontFamily: font.mono,
                              fontSize: type.label,
                              color: full ? colors.textFaint : colors.text,
                              background: checked ? colors.accentSoft : "transparent",
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
                              aria-label={`Compare run started ${formatTime(j.created_at)}, ${j.users} users`}
                            />
                            <span style={{ color: colors.accent }}>{checked ? `#${position + 1}` : ""}</span>
                            <span>{formatTime(j.created_at)}</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {j.target_url}
                            </span>
                            <span>{j.users}</span>
                            <span style={{ color: j.status === "completed" ? colors.textMuted : colors.text }}>{j.status}</span>
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
                    style={{ ...withDisabled(btnStyle, compareIds.length < 2 || comparing), marginTop: 0 }}
                    disabled={compareIds.length < 2 || comparing}
                  >
                    {comparing ? "Comparing…" : "Compare"}
                  </button>
                  <span style={{ fontSize: type.small, color: colors.textMuted }}>
                    {compareIds.length} selected
                    {compareIds.length < 2 && ". Select at least 2 runs to compare."}
                    {compareIds.length === 4 && ". That's the maximum of 4."}
                  </span>
                  <button onClick={refreshJobHistory} style={{ ...linkBtnStyle, marginLeft: "auto" }}>
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
