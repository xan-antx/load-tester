import { useState } from "react";
import Icon from "../Icon";
import { parseFailuresCsv } from "../../utils/parseFailuresCsv";
import { payloadText } from "../../utils/runReport";
import { outcome } from "../../theme";

// "Why did these fail?": every unexpected answer grouped by type, and under
// each type the cases that caused it, with their payloads.
export default function FailureReasons({ data, report }) {
  const [open, setOpen] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const groups = data.failure_summary || [];
  const payloadOf = Object.fromEntries(report.cases.map((c) => [c.name, c.payload]));

  const rawRows = parseFailuresCsv(data.aggregated_failures_csv || data.failures_csv);
  const rawGroups = Object.values(
    rawRows.reduce((acc, r) => {
      const error = r.Error || "(no error text)";
      const count = Number(r.Occurrences) || 0;
      if (!acc[error]) acc[error] = { error, total: 0, cases: [] };
      acc[error].total += count;
      acc[error].cases.push({ name: r.Name, count });
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  if (!groups.length && !rawGroups.length) return null;

  return (
    <section className="block" aria-labelledby="why-title">
      <div className="block-head">
        <h3 id="why-title">
          <button type="button" className="group-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
            Why did these fail?
            <span className="count">{groups.length} type{groups.length === 1 ? "" : "s"}</span>
          </button>
        </h3>
      </div>
      {open && (
        <div className="reasons">
          {groups.map((g) => {
            const tone = outcome[g.kind] || outcome.other;
            return (
              <article key={`${g.kind}-${g.code}`} className="reason">
                <header className="reason-head">
                  <span className="code-badge" style={{ color: tone.fg, borderColor: tone.fg, background: tone.soft }}>
                    {g.code ?? "no answer"}
                  </span>
                  <span className="reason-meaning">{tone.label}</span>
                  <span className="muted">{g.reason}</span>
                  <span className="num count">×{Number(g.total).toLocaleString()}</span>
                </header>
                <table className="reason-cases">
                  <tbody>
                    {g.cases.map((c) => {
                      const payload = payloadText(payloadOf[c.case]);
                      return (
                        <tr key={c.case}>
                          <td className="case-name">{c.case}</td>
                          <td className="num">×{Number(c.occurrences).toLocaleString()}</td>
                          <td>{payload ? <code className="payload" title={payload}>{payload}</code> : <span className="muted">payload not recorded in this browser</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </article>
            );
          })}
          {rawGroups.length > 0 && (
            <button type="button" className="btn-link" aria-expanded={showRaw} onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "Hide raw error messages" : `Show raw error messages (${rawGroups.length})`}
            </button>
          )}
          {showRaw && (
            <ul className="raw-errors">
              {rawGroups.map((g) => (
                <li key={g.error}>
                  <code>{g.error}</code> <span className="num muted">×{g.total}</span>
                  <span className="muted"> · {g.cases.map((c) => `${c.name} ×${c.count}`).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
