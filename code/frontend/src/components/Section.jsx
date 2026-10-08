import { colors, font, space, radius, type } from "../theme";

// How each workflow step state is shown, in the step panels and the rail.
export const STEP_STATES = {
  done: { label: "Done", color: colors.accent, mark: "✓" },
  active: { label: "Current step", color: colors.accent, mark: "●" },
  pending: { label: "Waiting", color: colors.textFaint, mark: "○" },
  skipped: { label: "Not needed", color: colors.textFaint, mark: "–" },
};

export function StepState({ state }) {
  const s = STEP_STATES[state] || STEP_STATES.pending;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: space.sm,
        fontFamily: font.mono,
        fontSize: type.meta,
        color: s.color,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">{s.mark}</span>
      {s.label}
    </span>
  );
}

// One workflow step: number, title, a one-line explanation and its state.
// The current step gets a stronger border so it stands out from the rest.
export default function Section({ id, step, title, description, state, children }) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      style={{
        border: `1px solid ${state === "active" ? colors.border : colors.borderSubtle}`,
        borderRadius: radius.lg,
        marginTop: space.lg,
        background: colors.surface,
        scrollMarginTop: 72,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: space.md,
          padding: `${space.md}px ${space.xl}px`,
          borderBottom: `1px solid ${colors.borderSubtle}`,
        }}
      >
        {step != null && (
          <span style={{ fontFamily: font.mono, fontSize: type.meta, color: colors.textMuted }}>
            {String(step).padStart(2, "0")}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            id={id ? `${id}-title` : undefined}
            style={{ margin: 0, fontSize: type.heading, fontWeight: 600, color: colors.text }}
          >
            {title}
          </h2>
          {description && (
            <p style={{ margin: `${space.xs}px 0 0`, fontSize: type.meta, color: colors.textMuted, maxWidth: "75ch" }}>
              {description}
            </p>
          )}
        </div>
        {state && <StepState state={state} />}
      </header>
      <div style={{ padding: space.xl }}>{children}</div>
    </section>
  );
}

// ---- Shared styles ----------------------------------------------------------
// Buttons are styled by CSS classes in index.css (btn btn-primary, btn
// btn-secondary, btn-link, btn-bare, toggle) so they get hover, active and
// disabled states, which inline styles can't express.

export const labelStyle = {
  display: "block",
  fontFamily: font.mono,
  fontSize: type.meta,
  color: colors.textMuted,
  marginBottom: space.xs,
};

export const inputStyle = {
  width: "100%",
  padding: `${space.sm}px ${space.md}px`,
  boxSizing: "border-box",
  background: colors.inset,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  color: colors.text,
  fontSize: type.body,
  fontFamily: font.mono,
};

export const subPanelStyle = {
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: radius.md,
  background: colors.surfaceRaised,
};

export const preStyle = {
  background: colors.inset,
  border: `1px solid ${colors.borderSubtle}`,
  padding: space.md,
  borderRadius: radius.md,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  marginTop: space.sm,
  maxHeight: 400,
  overflowY: "auto",
  color: colors.textMuted,
  fontFamily: font.mono,
  fontSize: type.meta,
  lineHeight: 1.6,
};

export const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: type.body,
};

export const thStyle = {
  padding: `${space.sm}px ${space.md}px`,
  color: colors.textMuted,
  fontFamily: font.mono,
  fontWeight: 400,
  fontSize: type.meta,
  textAlign: "left",
  whiteSpace: "nowrap",
  borderBottom: `1px solid ${colors.border}`,
};

export const tdStyle = {
  padding: `${space.sm}px ${space.md}px`,
  fontFamily: font.mono,
  fontSize: type.meta,
  color: colors.text,
  borderBottom: `1px solid ${colors.borderSubtle}`,
};

export const chipStyle = {
  fontFamily: font.mono,
  fontSize: type.meta,
  color: colors.textMuted,
  background: colors.inset,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: radius.sm,
  padding: `0 ${space.sm}px`,
  lineHeight: "20px",
};
