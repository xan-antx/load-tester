import { useId } from "react";
import TargetSection from "../components/newtest/TargetSection";
import CaseTable from "../components/newtest/CaseTable";
import LoadPanel from "../components/newtest/LoadPanel";
import OwnershipCheck from "../components/OwnershipCheck";
import Icon from "../components/Icon";

function SampleSection({ cases }) {
  const problemId = useId();
  const problem = cases.sampleProblem;
  return (
    <section className="setup-section" aria-labelledby="sample-title">
      <h2 id="sample-title" className="setup-title">Sample request</h2>
      <label htmlFor="sample-input" className="field-label">A JSON body the API accepts. The cases are built from it.</label>
      <textarea
        id="sample-input"
        rows={3}
        className="input mono"
        value={cases.sampleText}
        onChange={(e) => cases.setSampleText(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        spellCheck={false}
      />
      <div className="input-foot">
        {problem ? (
          <p id={problemId} className="field-error" role="status">
            <Icon name="alert" size={14} /> {problem}
          </p>
        ) : (
          <p className="field-note is-ok">
            <Icon name="check" size={14} /> Valid JSON
          </p>
        )}
        <button
          type="button"
          className={`btn ${cases.cases.length ? "btn-secondary" : "btn-primary"}`}
          onClick={() => cases.generate()}
          disabled={cases.generating || !!problem}
        >
          {cases.generating ? "Generating…" : cases.cases.length ? "Generate again" : "Generate cases"}
        </button>
      </div>
      {cases.error && !problem && (
        <p role="alert" className="field-error">
          <Icon name="alert" size={14} /> {cases.error}
        </p>
      )}
    </section>
  );
}

// New test: one compact setup screen. Main column: target, ownership,
// sample, cases. Sticky right column: load, SLO and Start.
export default function NewTestView({ target, cases, load, run, onStart }) {
  const analyzed = !!target.kind && !target.targetChanged;
  const isWebsite = target.isWebsite;
  const selectedCount = cases.selectedCases.length;

  const blockers = [];
  if (!analyzed) blockers.push(target.targetChanged ? "Analyze the changed URL again." : "Analyze the target first.");
  if (analyzed && !target.ownTarget) blockers.push("Confirm that you own the target or may test it.");
  if (analyzed && !isWebsite && cases.cases.length === 0) blockers.push("Generate cases from a sample request.");
  if (analyzed && !isWebsite && cases.cases.length > 0 && selectedCount === 0) blockers.push("Select at least one case.");
  if (load.runMode === "capacity" && !load.sloReady) blockers.push("Find capacity needs at least one SLO target (p95, average, server errors or wrong answers).");
  if (load.runMode === "capacity" && load.capacityTooLong) blockers.push(`The capacity plan is longer than 300 s (${load.capacitySeconds} s).`);

  return (
    <div className="new-test">
      <h1 className="visually-hidden">New test</h1>
      <div className="setup-main">
        <TargetSection target={target} />

        {analyzed && (
          <section className="setup-section ownership" aria-label="Permission">
            <OwnershipCheck id="own-target" checked={target.ownTarget} onChange={target.setOwnTarget} />
          </section>
        )}

        {analyzed && isWebsite && (
          <section className="setup-section" aria-labelledby="pages-title">
            <h2 id="pages-title" className="setup-title">Pages</h2>
            <p className="setup-text">
              {target.sitemapRaw
                ? "The test loads real pages listed in the site's sitemap."
                : "No sitemap was found, so the test loads only this page."}{" "}
              <span className="mono">{target.analyzedUrl}</span>
            </p>
          </section>
        )}

        {analyzed && !isWebsite && <SampleSection cases={cases} />}
        {analyzed && !isWebsite && cases.cases.length > 0 && <CaseTable cases={cases} />}

        {!analyzed && (
          <p className="setup-text empty-hint">
            Start with the URL of an API endpoint or a website you own. The app checks it, builds unusual inputs
            for an API, sends them under load, and tells you which ones the API mishandles.
          </p>
        )}
      </div>

      <LoadPanel
        load={load}
        caseCount={selectedCount}
        isWebsite={isWebsite}
        onStart={onStart}
        startState={{
          blockers,
          starting: run.starting,
          running: run.testRunning,
          error: run.startError,
          busy: run.busyNotice,
        }}
      />
    </div>
  );
}
