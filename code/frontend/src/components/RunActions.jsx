import Icon from "./Icon";
import { buildMarkdownReport, downloadTextFile } from "../utils/report";

// The actions under a finished result. Secondary buttons only: the one
// primary action on this screen is "Start" on the New test view.
export default function RunActions({ run, config, regressionInfo, onMarkBaseline, markingBaseline, onRerun, onEdit, rerunBlocked }) {
  const id = run.job_id || run.group_id;
  const completed = run.status === "completed";

  function downloadReport() {
    const text = buildMarkdownReport(run, regressionInfo, config);
    downloadTextFile(`load-test-report-${String(id).slice(0, 8)}.md`, text);
  }

  return (
    <div className="actions-bar" role="group" aria-label="Run actions">
      {onRerun && (
        <button type="button" className="btn btn-secondary" onClick={onRerun} disabled={rerunBlocked}>
          <Icon name="refresh" /> Re-run with same settings
        </button>
      )}
      {onEdit && (
        <button type="button" className="btn btn-secondary" onClick={onEdit}>
          <Icon name="edit" /> Edit and re-run
        </button>
      )}
      {completed && !regressionInfo?.is_current_baseline && (
        <button type="button" onClick={onMarkBaseline} className="btn btn-secondary" disabled={markingBaseline}>
          <Icon name="star" /> {markingBaseline ? "Saving…" : "Mark as baseline"}
        </button>
      )}
      {completed && (
        <button type="button" onClick={downloadReport} className="btn btn-secondary">
          <Icon name="download" /> Download report (.md)
        </button>
      )}
    </div>
  );
}
