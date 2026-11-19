import { useId, useState } from "react";
import Icon from "../Icon";
import Popover from "../Popover";
import RequestHeadersEditor from "../RequestHeadersEditor";
import { colors } from "../../theme";

// The analysis as one line of chips; the long explanations sit in a "?".
function AnalyzeChip({ data }) {
  const [showRaw, setShowRaw] = useState(false);
  const sanity = data.sanity || {};
  const kind = data.type_detection?.classification;
  const sitemap = data.sitemap;
  return (
    <div className="analyze-chip-row">
      <span className={`status-chip ${sanity.reachable ? "is-ok" : "is-bad"}`}>
        <Icon name={sanity.reachable ? "check" : "cross"} size={14} />
        {sanity.reachable ? "Reachable" : "Not reachable"}
      </span>
      {sanity.status_code != null && (
        <span className="status-chip">
          Status <span className="mono">{sanity.status_code}</span>
        </span>
      )}
      {kind && <span className="status-chip">Looks like {kind === "api" ? "an API" : kind === "website" ? "a website" : kind}</span>}
      {sitemap && <span className="status-chip">Sitemap {sitemap.found ? "found" : "not found"}</span>}
      <Popover label="What did the analysis check?" width={380}>
        <span className="pop-p">
          The backend sends only read-only requests (HEAD, GET, OPTIONS), so the check never changes anything on
          the server.
        </span>
        {sanity.method_not_allowed && (
          <span className="pop-p">
            The server refused HEAD and GET ({sanity.status_code})
            {sanity.allowed_methods ? ` and allows ${sanity.allowed_methods}` : ""}. That is normal for an endpoint
            that only accepts POST.
          </span>
        )}
        {kind === "api" && <span className="pop-p">It looks like an API, so the test sends JSON bodies built from your sample.</span>}
        {kind === "website" && <span className="pop-p">It looks like a website, so the test loads its pages (from the sitemap when there is one).</span>}
        {sanity.error && <span className="pop-p mono">Technical detail: {sanity.error}</span>}
        <button type="button" className="btn-link" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw}>
          {showRaw ? "Hide raw response" : "Show raw response"}
        </button>
        {showRaw && <pre className="code-block">{JSON.stringify(data, null, 2)}</pre>}
      </Popover>
    </div>
  );
}

export default function TargetSection({ target }) {
  const errorId = useId();
  const t = target;
  return (
    <section className="setup-section" aria-labelledby="target-title">
      <h2 id="target-title" className="setup-title">Target</h2>
      <label htmlFor="target-url" className="field-label">URL of the API endpoint or website</label>
      <div className="input-row">
        <input
          id="target-url"
          className="input mono"
          value={t.url}
          onChange={(e) => t.setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !t.analyzing) t.analyze();
          }}
          aria-invalid={t.error ? true : undefined}
          aria-describedby={t.error ? errorId : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" onClick={t.analyze} className={`btn ${t.kind && !t.targetChanged ? "btn-secondary" : "btn-primary"}`} disabled={t.analyzing}>
          {t.analyzing ? "Analyzing…" : t.kind && !t.targetChanged ? "Analyze again" : "Analyze"}
        </button>
      </div>
      {t.error && (
        <p id={errorId} role="alert" className="field-error">
          <Icon name="alert" size={14} /> {t.error}
        </p>
      )}
      {t.targetChanged && (
        <p role="status" className="field-note">
          <Icon name="alert" size={14} color={colors.text} /> The URL changed since it was analyzed. Analyze it again before starting.
        </p>
      )}
      {t.analyzeResult && !t.targetChanged && <AnalyzeChip data={t.analyzeResult} />}
      <RequestHeadersEditor rows={t.requestHeaders} onChange={t.setRequestHeaders} />
    </section>
  );
}
