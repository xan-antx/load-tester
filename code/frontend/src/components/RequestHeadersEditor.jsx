import { inputStyle, labelStyle } from "./Section";
import { colors, space, type } from "../theme";

// Optional request headers such as "Authorization: Bearer <token>".
// rows: [{ id, name, value }]. Values are typed into password fields so they
// stay masked on screen; they live only in memory and are sent with each
// request, never saved by the backend.
export default function RequestHeadersEditor({ rows, onChange }) {
  function update(id, field, text) {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: text } : r)));
  }

  function addRow() {
    onChange([...rows, { id: Date.now() + Math.random(), name: "", value: "" }]);
  }

  return (
    <details style={{ marginTop: space.md }} open={rows.length > 0}>
      <summary style={{ cursor: "pointer", fontSize: type.body, color: colors.accent }}>
        Request headers (optional){rows.length > 0 ? ` · ${rows.length}` : ""}
      </summary>
      <p style={{ fontSize: type.meta, color: colors.textMuted, margin: `${space.sm}px 0` }}>
        For APIs that need authentication, e.g. <code>Authorization</code> = <code>Bearer &lt;token&gt;</code>.
        Headers are sent with every load-test request and with the next Analyze. Values are never
        saved, logged or shown again; only the header names are kept with the run.
      </p>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: "flex", gap: space.sm, alignItems: "flex-end", marginBottom: space.sm }}>
          <label style={{ flex: "1 1 40%" }}>
            <span style={labelStyle}>Header {i + 1} name</span>
            <input
              style={inputStyle}
              value={r.name}
              placeholder="Authorization"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => update(r.id, "name", e.target.value)}
            />
          </label>
          <label style={{ flex: "1 1 60%" }}>
            <span style={labelStyle}>Header {i + 1} value (hidden)</span>
            <input
              type="password"
              style={inputStyle}
              value={r.value}
              placeholder="Bearer …"
              autoComplete="new-password"
              onChange={(e) => update(r.id, "value", e.target.value)}
            />
          </label>
          <button
            onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
            aria-label={`Remove header ${r.name || i + 1}`}
            className="btn btn-secondary btn-small"
            style={{ marginBottom: 2 }}
          >
            Remove
          </button>
        </div>
      ))}
      <button onClick={addRow} className="btn btn-secondary btn-small">
        Add header
      </button>
    </details>
  );
}

// {name: value} for the rows that have a name; what the backend expects.
export function headersObject(rows) {
  const out = {};
  rows.forEach((r) => {
    if (r.name.trim()) out[r.name.trim()] = r.value;
  });
  return out;
}
