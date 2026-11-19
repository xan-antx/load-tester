import { useId, useState } from "react";
import Icon from "../Icon";
import Popover from "../Popover";
import { CATEGORY_LABELS, CATEGORY_ORDER, payloadText } from "../../utils/runReport";

// The generator writes descriptions like "SQL injection attempt in
// 'username'" for several cases; the payload is what tells them apart, so
// the table shows the value that changed for each case.
function changedValue(c, sample) {
  if (!sample || typeof c.payload !== "object" || c.payload === null) return payloadText(c.payload);
  const keys = new Set([...Object.keys(sample), ...Object.keys(c.payload)]);
  const parts = [];
  keys.forEach((k) => {
    const inSample = Object.prototype.hasOwnProperty.call(sample, k);
    const inCase = Object.prototype.hasOwnProperty.call(c.payload, k);
    if (inSample && !inCase) parts.push(`${k}: (removed)`);
    else if (JSON.stringify(sample[k]) !== JSON.stringify(c.payload[k])) parts.push(`${k}: ${JSON.stringify(c.payload[k])}`);
  });
  return parts.length ? parts.join(", ") : "unchanged (the sample as given)";
}

function ExpectControl({ c, value, onChange }) {
  return (
    <div role="group" aria-label={`Expected answer for ${c.label}`} className="segmented is-small">
      {[
        ["accept", "2xx", "Valid input: a 2xx answer is correct"],
        ["reject", "4xx", "Invalid input: a 4xx rejection is correct"],
      ].map(([v, text, title]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          title={title}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function CustomCaseForm({ cases }) {
  const [label, setLabel] = useState("");
  const [payloadText_, setPayloadText] = useState("");
  const [expect, setExpect] = useState("reject");
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const labelErr = useId();
  const payloadErr = useId();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const res = await cases.addCustom({ label, payloadText: payloadText_, expect });
    setBusy(false);
    setMessage(res);
    if (res.ok) {
      setLabel("");
      setPayloadText("");
    }
  }

  return (
    <details className="custom-case">
      <summary>Add your own case</summary>
      <form onSubmit={submit} className="custom-form">
        <div>
          <label htmlFor="custom-label" className="field-label">Name (lowercase letters, digits, _)</label>
          <input
            id="custom-label"
            className="input mono"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-invalid={message && !message.ok && message.field === "label" ? true : undefined}
            aria-describedby={message && !message.ok && message.field === "label" ? labelErr : undefined}
          />
          {message && !message.ok && message.field === "label" && <p id={labelErr} role="alert" className="field-error">{message.text}</p>}
        </div>
        <div>
          <label htmlFor="custom-payload" className="field-label">JSON body to send (must differ from the sample)</label>
          <textarea
            id="custom-payload"
            rows={3}
            className="input mono"
            value={payloadText_}
            onChange={(e) => setPayloadText(e.target.value)}
            aria-invalid={message && !message.ok && message.field === "payload" ? true : undefined}
            aria-describedby={message && !message.ok && message.field === "payload" ? payloadErr : undefined}
          />
          {message && !message.ok && message.field === "payload" && <p id={payloadErr} role="alert" className="field-error">{message.text}</p>}
        </div>
        <div className="custom-form-foot">
          <span className="field-label is-inline">Expected answer</span>
          <ExpectControl c={{ label: "the new case" }} value={expect} onChange={setExpect} />
          <button type="submit" className="btn btn-secondary" disabled={busy || !label.trim() || !payloadText_.trim()}>
            {busy ? "Checking…" : "Check and add"}
          </button>
        </div>
        {message?.ok && <p role="status" className="field-note">{message.text}</p>}
      </form>
    </details>
  );
}

// Every case with its payload; filter by category or search, select per
// category, and set each case's expected answer.
export default function CaseTable({ cases }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const all = cases.allCases;
  const sample = cases.sampleInput;
  const categories = CATEGORY_ORDER.filter((cat) => all.some((c) => c.category === cat))
    .concat([...new Set(all.map((c) => c.category))].filter((cat) => !CATEGORY_ORDER.includes(cat)));

  const q = query.trim().toLowerCase();
  const visible = all.filter(
    (c) =>
      (filter === "all" || c.category === filter) &&
      (!q || c.label.toLowerCase().includes(q) || (c.description || "").toLowerCase().includes(q) || (payloadText(c.payload) || "").toLowerCase().includes(q))
  );
  const visibleLabels = visible.map((c) => c.label);
  const visibleOn = visible.filter((c) => cases.selected[c.label]).length;
  const scopeName = filter === "all" ? (q ? "shown" : "all") : CATEGORY_LABELS[filter] || filter;

  return (
    <section className="setup-section" aria-labelledby="cases-setup-title">
      <div className="setup-head">
        <h2 id="cases-setup-title" className="setup-title">
          Cases <span className="count">{cases.selectedCases.length} of {all.length} selected</span>
        </h2>
        <Popover label="How are cases judged?" align="end">
          Each case has an expected answer. Valid input should get a 2xx; invalid input should be rejected with a
          4xx. If a field is optional, set its "missing" and "null" cases to 2xx, or they will show up as accepted
          invalid input.
        </Popover>
      </div>

      <div className="case-toolbar">
        <div role="group" aria-label="Filter by category" className="filter-chips">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All <span className="num">{cases.selectedCases.length}/{all.length}</span>
          </button>
          {categories.map((cat) => {
            const inCat = all.filter((c) => c.category === cat);
            const on = inCat.filter((c) => cases.selected[c.label]).length;
            return (
              <button key={cat} type="button" aria-pressed={filter === cat} onClick={() => setFilter(cat)}>
                {CATEGORY_LABELS[cat] || cat} <span className="num">{on}/{inCat.length}</span>
              </button>
            );
          })}
        </div>
        <div className="case-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            className="input"
            placeholder="Search cases or payloads"
            aria-label="Search cases or payloads"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="select-actions">
          <button type="button" className="btn-link" onClick={() => cases.setMany(visibleLabels, true)} disabled={visibleOn === visible.length}>
            Select {scopeName}
          </button>
          <button type="button" className="btn-link" onClick={() => cases.setMany(visibleLabels, false)} disabled={visibleOn === 0}>
            Select none{filter !== "all" || q ? ` (${scopeName})` : ""}
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table case-table">
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">Send</span></th>
              <th scope="col">Case</th>
              <th scope="col">What it sends</th>
              <th scope="col">Expected answer</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const id = `case-${c.label}`;
              const full = payloadText(c.payload);
              return (
                <tr key={c.label} className={cases.selected[c.label] ? undefined : "is-off"}>
                  <td className="check-cell">
                    <input id={id} type="checkbox" checked={!!cases.selected[c.label]} onChange={() => cases.toggle(c.label)} />
                  </td>
                  <td>
                    <label htmlFor={id} className="case-label">
                      <span className="case-name">{c.label}</span>
                      <span className="case-desc">{c.description}</span>
                    </label>
                  </td>
                  <td className="payload-cell">
                    <code className="payload" title={full}>{changedValue(c, sample)}</code>
                  </td>
                  <td>
                    <div className="expect-cell">
                      <ExpectControl c={c} value={cases.expectOf(c)} onChange={(v) => cases.setExpect(c, v)} />
                      {c.isCustom && (
                        <button type="button" className="icon-btn" aria-label={`Remove your case ${c.label}`} onClick={() => cases.removeCustom(c.label)}>
                          <Icon name="close" size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">No case matches “{query}”.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <CustomCaseForm cases={cases} />
    </section>
  );
}
