import { useState } from "react";
import Icon from "../Icon";
import OutcomeStrip from "../OutcomeStrip";
import { CATEGORY_LABELS, CATEGORY_ORDER, formatMs, formatPct, payloadText } from "../../utils/runReport";
import { colors } from "../../theme";

// Untested cases sort after every tested one, whatever the direction.
function sortValue(c, key) {
  switch (key) {
    case "name": return c.name;
    case "requests": return c.requests;
    case "unexpected": return c.unexpected;
    case "rate": return c.unexpectedPct ?? -1;
    case "avg": return c.avg ?? -1;
    case "p95": return c.p95 ?? -1;
    case "max": return c.max ?? -1;
    default: return 0;
  }
}

function sumCases(list) {
  const requests = list.reduce((s, c) => s + c.requests, 0);
  const unexpected = list.reduce((s, c) => s + c.unexpected, 0);
  const kinds = {};
  list.forEach((c) => Object.entries(c.kinds).forEach(([k, v]) => (kinds[k] = (kinds[k] || 0) + v)));
  return { requests, unexpected, kinds, rate: requests ? (unexpected / requests) * 100 : null };
}

// Per-case results. "Unexpected" is the same figure as the headline KPI:
// answers that differ from what a correct API gives (runReport.js).
export default function CaseResultsTable({ report }) {
  const [sort, setSort] = useState({ key: "rate", dir: "desc" });
  const [view, setView] = useState("flat");
  const [collapsed, setCollapsed] = useState({});
  const { cases, isWebsite, isGroup, hasExpectations } = report;
  if (!cases.length) return null;

  const approx = isGroup ? "≈" : "";
  const unexpectedLabel = hasExpectations ? "Unexpected" : "Failed";
  const columns = [
    { key: "name", label: isWebsite ? "Page" : "Case" },
    ...(hasExpectations ? [{ key: "expect", label: "Expects", sortable: false }] : []),
    { key: "requests", label: "Requests", numeric: true },
    { key: "unexpected", label: unexpectedLabel, numeric: true },
    { key: "rate", label: `${unexpectedLabel} share` },
    { key: "avg", label: "Avg ms", numeric: true },
    { key: "p95", label: `${approx}p95 ms`, numeric: true },
    { key: "max", label: "Max ms", numeric: true },
  ];

  const sorted = [...cases].sort((a, b) => {
    if (a.tested !== b.tested) return a.tested ? -1 : 1;
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sort.dir === "asc" ? cmp : -cmp;
  });
  const activeView = isWebsite ? "flat" : view;
  const groups = CATEGORY_ORDER.map((cat) => ({ cat, rows: sorted.filter((c) => c.category === cat) }))
    .filter((g) => g.rows.length);

  function toggleSort(key) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  const outcomeCell = (requests, kinds, unexpected, rate, tested = true) => (
    <td>
      {tested ? (
        <div className="outcome-cell">
          <div className="grow">
            <OutcomeStrip requests={requests} kindCounts={kinds} failureTotal={unexpected} passedLabel="Expected answer" />
          </div>
          <span className="num pct" style={{ color: unexpected ? colors.text : colors.textMuted }}>{formatPct(rate)}</span>
        </div>
      ) : (
        <span className="untested-tag">
          <Icon name="untested" dashed size={12} /> Not tested: no requests
        </span>
      )}
    </td>
  );

  const caseRow = (c) => {
    const payload = payloadText(c.payload);
    return (
      <tr key={c.name} className={c.tested ? undefined : "is-untested"}>
        <td className="case-cell">
          <span className="case-name">{c.name}</span>
          {payload && <code className="payload" title={payload}>{payload}</code>}
        </td>
        {hasExpectations && <td>{c.expect ? <span className="expect-tag">{c.expect === "accept" ? "2xx" : "4xx"}</span> : "—"}</td>}
        <td className="num">{c.requests.toLocaleString()}</td>
        <td className="num">{c.tested ? c.unexpected.toLocaleString() : "—"}</td>
        {outcomeCell(c.requests, c.kinds, c.unexpected, c.unexpectedPct, c.tested)}
        <td className="num">{formatMs(c.avg)}</td>
        <td className="num">{c.p95 == null ? "—" : `${approx}${formatMs(c.p95)}`}</td>
        <td className="num">{formatMs(c.max)}</td>
      </tr>
    );
  };

  return (
    <section aria-labelledby="cases-title" className="block">
      <div className="block-head">
        <h3 id="cases-title">
          {isWebsite ? "Pages" : "Cases"} <span className="count">{cases.length}</span>
        </h3>
        {!isWebsite && (
          <div role="group" aria-label="Table layout" className="segmented">
            <button type="button" aria-pressed={view === "flat"} onClick={() => setView("flat")}>Flat</button>
            <button type="button" aria-pressed={view === "grouped"} onClick={() => setView("grouped")}>By category</button>
          </div>
        )}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.numeric ? "num" : undefined}
                  aria-sort={c.sortable === false ? undefined : sort.key === c.key ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
                >
                  {c.sortable === false ? c.label : (
                    <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sort.key === c.key && <Icon name="chevronDown" size={12} style={{ transform: sort.dir === "asc" ? "rotate(180deg)" : undefined }} />}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeView === "flat" && sorted.map(caseRow)}
            {activeView === "grouped" &&
              groups.map((g) => {
                const open = !collapsed[g.cat];
                const s = sumCases(g.rows);
                const untestedHere = g.rows.filter((c) => !c.tested).length;
                return [
                  <tr key={`h-${g.cat}`} className="group-row">
                    <td colSpan={hasExpectations ? 2 : 1}>
                      <button
                        type="button"
                        className="group-toggle"
                        aria-expanded={open}
                        onClick={() => setCollapsed((p) => ({ ...p, [g.cat]: !p[g.cat] }))}
                      >
                        <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
                        {CATEGORY_LABELS[g.cat] || g.cat}
                        <span className="count">{g.rows.length}</span>
                        {untestedHere > 0 && <span className="muted">· {untestedHere} not tested</span>}
                      </button>
                    </td>
                    <td className="num">{s.requests.toLocaleString()}</td>
                    <td className="num">{s.unexpected.toLocaleString()}</td>
                    {outcomeCell(s.requests, s.kinds, s.unexpected, s.rate, s.requests > 0)}
                    <td colSpan={3} />
                  </tr>,
                  ...(open ? g.rows.map(caseRow) : []),
                ];
              })}
            <tr className="total-row">
              <td colSpan={hasExpectations ? 2 : 1}>Total</td>
              <td className="num">{report.requests.toLocaleString()}</td>
              <td className="num">{report.unexpected.toLocaleString()}</td>
              {outcomeCell(report.requests, report.kinds, report.unexpected, report.unexpectedPct, report.requests > 0)}
              <td className="num">{formatMs(report.avg)}</td>
              <td className="num">{report.p95 == null ? "—" : `${approx}${formatMs(report.p95)}`}</td>
              <td className="num">{formatMs(report.max)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
