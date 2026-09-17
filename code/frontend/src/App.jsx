import { useState, useEffect } from "react";
import Section, { btnStyle, inputStyle } from "./components/Section";
import AnalyzeSummary from "./components/AnalyzeSummary";
import JobResultSummary from "./components/JobResultSummary";
import CompareView from "./components/CompareView";
import WebsiteLoadTestSection from "./components/WebsiteLoadTestSection";
import LoadTestConfig from "./components/LoadTestConfig";
import { colors, font, space, radius } from "./theme";

const BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

// Navigation-only step indicator: scrolls to sections, never hides them.
function StepDot({ n, label, complete, available, targetId }) {
  return (
    <button
      onClick={() =>
        available &&
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
      title={`${n}. ${label}${complete ? " — done" : available ? "" : " — not reached yet"}`}
      aria-label={`Go to step ${n}: ${label}`}
      disabled={!available}
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: `1px solid ${complete ? colors.accent : colors.border}`,
        background: complete ? colors.accentSoft : colors.surface,
        color: complete ? colors.accent : available ? colors.text : colors.textMuted,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: font.mono,
        cursor: available ? "pointer" : "default",
        opacity: available || complete ? 1 : 0.45,
        padding: 0,
      }}
    >
      {complete ? "✓" : n}
    </button>
  );
}

export default function App() {
  const [url, setUrl] = useState("https://httpbin.org/post");
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [isApi, setIsApi] = useState(false);
  const [isWebsite, setIsWebsite] = useState(false);
  const [sitemapRaw, setSitemapRaw] = useState(null);
  const [showRawAnalyze, setShowRawAnalyze] = useState(false);

  const [sampleInputText, setSampleInputText] = useState(
    '{"username": "john_doe", "age": 25}'
  );
  const [sampleInput, setSampleInput] = useState(null);
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState({});

  const [testUsers, setTestUsers] = useState(3);
  const [testSpawnRate, setTestSpawnRate] = useState(1);
  const [testDuration, setTestDuration] = useState(10);

  const [jobId, setJobId] = useState(null);
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [runDuration, setRunDuration] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobResult, setJobResult] = useState(null);
  const [showRawJob, setShowRawJob] = useState(false);
  const [websitePathsUsed, setWebsitePathsUsed] = useState(null);

  const [jobHistory, setJobHistory] = useState([]);
  const [compareIdA, setCompareIdA] = useState("");
  const [compareIdB, setCompareIdB] = useState("");
  const [compareResult, setCompareResult] = useState(null);

  const [error, setError] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
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
  }

  function toggleCase(label) {
    setSelected((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function setAllCases(value) {
    const next = {};
    cases.forEach((c) => (next[c.label] = value));
    setSelected(next);
  }

  function toggleCategory(category) {
    const inCategory = cases.filter((c) => c.category === category);
    const allOn = inCategory.every((c) => selected[c.label]);
    setSelected((prev) => {
      const next = { ...prev };
      inCategory.forEach((c) => (next[c.label] = !allOn));
      return next;
    });
  }

  const selectedCount = cases.filter((c) => selected[c.label]).length;
  const caseCategories = [...new Set(cases.map((c) => c.category))];

  async function confirmAndStart() {
    if (testRunning) return;
    setError(null);
    const selectedLabels = Object.keys(selected).filter((l) => selected[l]);
    if (selectedLabels.length === 0) {
      setError("Select at least one edge case");
      return;
    }

    const confirmResp = await fetch(`${BASE}/api/confirm-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sample_input: sampleInput, selected_labels: selectedLabels }),
    });
    const confirmData = await confirmResp.json();
    if (!confirmResp.ok) {
      setError(JSON.stringify(confirmData));
      return;
    }

    const startResp = await fetch(`${BASE}/api/start-load-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        confirmed_cases: confirmData.confirmed_cases,
        users: testUsers,
        spawn_rate: testSpawnRate,
        duration_seconds: testDuration,
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
    setRunDuration(testDuration);
    setElapsedSec(0);
    setJobStatus("queued");
    setJobResult(null);
    pollStatus(startData.job_id);
  }

  async function startWebsiteLoadTest() {
    if (testRunning) return;
    setError(null);
    setStartingWebsiteTest(true);
    try {
      const resp = await fetch(`${BASE}/api/start-website-load-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          sitemap_raw: sitemapRaw,
          users: testUsers,
          spawn_rate: testSpawnRate,
          duration_seconds: testDuration,
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
      setRunDuration(testDuration);
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

  async function runComparison() {
    setError(null);
    setCompareResult(null);
    if (!compareIdA || !compareIdB) {
      setError("Pick two runs to compare");
      return;
    }
    const resp = await fetch(`${BASE}/api/compare-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id_a: compareIdA, job_id_b: compareIdB }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setError(data.error || "Could not compare those runs");
      return;
    }
    setCompareResult(data);
  }

  // Guards against starting a second job while one is polling: two concurrent
  // pollStatus loops would both write jobStatus/jobResult and clobber each other.
  const testRunning = jobStatus === "queued" || jobStatus === "running";

  const bulkBtnStyle = {
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 600,
    background: "transparent",
    color: colors.accent,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    cursor: "pointer",
  };

  const statusColors = {
    queued: colors.textMuted,
    running: colors.warning,
    completed: colors.success,
    failed: colors.danger,
    timeout: colors.danger,
  };
  const statusColor = statusColors[jobStatus] || colors.textMuted;

  return (
    <div
      style={{
        fontFamily: font.sans,
        maxWidth: 720,
        margin: "0 auto",
        padding: `${space.xxl}px ${space.xl}px`,
        color: colors.text,
      }}
    >
      <nav className="step-rail" aria-label="Workflow steps">
        {[
          { n: 1, label: "Enter target", complete: analyzeResult != null, available: true, targetId: "step-1" },
          { n: 2, label: "Sample input", complete: cases.length > 0, available: isApi, targetId: "step-2" },
          { n: 3, label: "Select edge cases", complete: jobId != null, available: cases.length > 0, targetId: "step-3" },
          { n: 4, label: "Load test status", complete: jobResult != null, available: jobId != null, targetId: "step-4" },
          { n: 5, label: "Compare past runs", complete: compareResult != null, available: jobHistory.length > 0, targetId: "step-5" },
        ].map((s) => (
          <StepDot key={s.n} {...s} />
        ))}
      </nav>

      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: space.xs }}>
        Elevate Load Tester
      </h1>
      <p style={{ color: colors.textMuted, fontSize: 14, marginTop: 0, marginBottom: space.xl }}>
        Analyze a target, generate edge cases or crawl its pages, then run an async load test.
      </p>

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: space.sm,
            background: colors.dangerSoft,
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.md,
            marginBottom: space.lg,
            fontSize: 13,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            style={{
              background: "transparent",
              border: "none",
              color: colors.danger,
              cursor: "pointer",
              fontSize: 15,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      <Section id="step-1" title="1. Enter target">
        <input
          style={inputStyle}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/api/endpoint"
        />
        <button onClick={analyzeUrl} style={btnStyle} disabled={analyzing}>
          {analyzing ? "Analyzing…" : "Analyze"}
        </button>

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
        <Section id="step-2" title="2. Sample input for API targets">
          <p style={{ color: colors.textMuted, fontSize: 13.5, marginTop: 0 }}>
            Paste a sample JSON body this API expects
          </p>
          <textarea
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
            value={sampleInputText}
            onChange={(e) => setSampleInputText(e.target.value)}
          />
          <button onClick={generateEdgeCases} style={btnStyle}>Generate edge cases</button>
        </Section>
      )}

      {cases.length > 0 && (
        <Section id="step-3" title="3. Select edge cases">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: space.sm,
              marginBottom: space.sm,
            }}
          >
            <button onClick={() => setAllCases(true)} style={bulkBtnStyle}>
              Select all
            </button>
            <button onClick={() => setAllCases(false)} style={bulkBtnStyle}>
              Select none
            </button>
            <span style={{ marginLeft: "auto", fontSize: 12.5, color: colors.textMuted, fontFamily: font.mono }}>
              {selectedCount} of {cases.length} selected
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: space.xs, marginBottom: space.sm }}>
            {caseCategories.map((cat) => {
              const inCategory = cases.filter((c) => c.category === cat);
              const onCount = inCategory.filter((c) => selected[c.label]).length;
              const allOn = onCount === inCategory.length;
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  title={allOn ? `Deselect all ${cat} cases` : `Select all ${cat} cases`}
                  style={{
                    padding: "3px 10px",
                    fontSize: 11.5,
                    fontFamily: font.mono,
                    borderRadius: radius.pill,
                    cursor: "pointer",
                    background: allOn ? colors.accentSoft : "transparent",
                    color: allOn ? colors.accent : colors.textMuted,
                    border: `1px solid ${allOn ? colors.accent : colors.border}`,
                  }}
                >
                  {cat} {onCount}/{inCategory.length}
                </button>
              );
            })}
          </div>

          <div
            className="case-list"
            style={{
              maxHeight: 360,
              overflowY: "auto",
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: space.md,
              background: colors.bg,
            }}
          >
            {cases.map((c) => (
              <label
                key={c.label}
                style={{ display: "block", padding: "6px 4px", fontSize: 13.5, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={!!selected[c.label]}
                  onChange={() => toggleCase(c.label)}
                  style={{ marginRight: 8 }}
                />
                <span style={{ color: colors.accent, fontFamily: font.mono, fontSize: 11.5 }}>
                  [{c.category}]
                </span>{" "}
                <span style={{ color: colors.text }}>{c.description}</span>
              </label>
            ))}
          </div>

          <LoadTestConfig
            users={testUsers}
            spawnRate={testSpawnRate}
            duration={testDuration}
            onUsersChange={setTestUsers}
            onSpawnRateChange={setTestSpawnRate}
            onDurationChange={setTestDuration}
          />

          <button onClick={confirmAndStart} style={btnStyle} disabled={testRunning}>
            {testRunning ? "Test in progress…" : "Confirm selection and start load test"}
          </button>
        </Section>
      )}

      {jobId && (
        <Section id="step-4" title="4. Load test status">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: space.sm }}>
            <span style={{ color: colors.textMuted }}>
              Job <span style={{ fontFamily: font.mono, color: colors.text }}>{jobId}</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: space.sm }}>
              {jobResult?.child_jobs?.length > 1 && (
                <span
                  style={{
                    background: colors.accentSoft,
                    color: colors.accent,
                    fontFamily: font.mono,
                    fontSize: 11,
                    padding: "2px 9px",
                    borderRadius: radius.pill,
                    whiteSpace: "nowrap",
                  }}
                >
                  Split across {jobResult.child_jobs.length} workers
                </span>
              )}
              <span style={{ color: statusColor, fontWeight: 600, textTransform: "capitalize" }}>
                {jobStatus}
              </span>
            </span>
          </div>
          {["queued", "running"].includes(jobStatus) && runDuration != null && (
            <div style={{ marginBottom: space.md }}>
              <div
                style={{
                  height: 6,
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
                    borderRadius: radius.pill,
                    transition: "width 0.5s linear",
                  }}
                />
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: font.mono }}>
                {elapsedSec}s elapsed · ~{runDuration}s configured (estimate — includes ramp-up
                and teardown)
              </div>
            </div>
          )}

          {websitePathsUsed && (
            <p style={{ fontSize: 12.5, color: colors.textMuted, fontFamily: font.mono }}>
              Pages tested: {websitePathsUsed.join(", ")}
            </p>
          )}

          {jobResult && (
            <JobResultSummary
              data={jobResult}
              showRaw={showRawJob}
              onToggleRaw={() => setShowRawJob((v) => !v)}
            />
          )}
        </Section>
      )}

      {jobHistory.length > 0 && (
        <Section id="step-5" title="5. Compare past runs">
          <>
            <div style={{ display: "flex", gap: space.sm, marginBottom: space.md }}>
              <select
                style={{ ...inputStyle, flex: 1, fontFamily: font.sans }}
                value={compareIdA}
                onChange={(e) => setCompareIdA(e.target.value)}
              >
                <option value="">— Run A —</option>
                {jobHistory.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.target_url} · {j.users}u · {j.status} · {j.created_at}
                  </option>
                ))}
              </select>
              <select
                style={{ ...inputStyle, flex: 1, fontFamily: font.sans }}
                value={compareIdB}
                onChange={(e) => setCompareIdB(e.target.value)}
              >
                <option value="">— Run B —</option>
                {jobHistory.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.target_url} · {j.users}u · {j.status} · {j.created_at}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={runComparison} style={btnStyle}>Compare</button>
            <button
              onClick={refreshJobHistory}
              style={{ ...btnStyle, background: "transparent", color: colors.accent, marginLeft: space.sm, boxShadow: "none" }}
            >
              Refresh list
            </button>

            {compareResult && <CompareView jobA={compareResult.job_a} jobB={compareResult.job_b} />}
          </>
        </Section>
      )}
    </div>
  );
}