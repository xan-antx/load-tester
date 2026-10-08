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
        gap: 6,
        fontFamily: font.mono,
        fontSize: type.label,
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
          <span style={{ fontFamily: font.mono, fontSize: type.label, color: colors.textMuted }}>
            {String(step).padStart(2, "0")}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            id={id ? `${id}-title` : undefined}
            style={{ margin: 0, fontSize: type.heading, fontWeight: 600, color: colors.text, lineHeight: 1.3 }}
          >
            {title}
          </h2>
          {description && (
            <p style={{ margin: "2px 0 0", fontSize: type.small, color: colors.textMuted }}>{description}</p>
          )}
        </div>
        {state && <StepState state={state} />}
      </header>
      <div style={{ padding: space.xl }}>{children}</div>
    </section>
  );
}

// ---- Shared control styles ------------------------------------------------

export const btnStyle = {
  marginTop: space.sm,
  padding: "8px 16px",
  background: colors.accent,
  color: colors.onAccent,
  border: `1px solid ${colors.accent}`,
  borderRadius: radius.md,
  cursor: "pointer",
  fontSize: type.body,
  fontWeight: 600,
};

export const secondaryBtnStyle = {
  ...btnStyle,
  background: "transparent",
  color: colors.text,
  border: `1px solid ${colors.border}`,
  fontWeight: 500,
};

// Text-only action ("Show raw response", "Refresh list").
export const linkBtnStyle = {
  background: "transparent",
  border: "none",
  color: colors.accent,
  cursor: "pointer",
  fontSize: type.small,
  padding: `${space.xs}px 0`,
};

// Greys a button out while it can't be used (e.g. a test is running).
export function withDisabled(style, disabled) {
  return disabled
    ? { ...style, background: colors.surfaceRaised, color: colors.textFaint, border: `1px solid ${colors.borderSubtle}` }
    : style;
}

export const labelStyle = {
  display: "block",
  fontFamily: font.mono,
  fontSize: type.label,
  color: colors.textMuted,
  marginBottom: space.xs,
};

export const inputStyle = {
  width: "100%",
  padding: "9px 12px",
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
  fontSize: type.small,
  lineHeight: 1.6,
};

export const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

export const thStyle = {
  padding: "8px 10px",
  color: colors.textMuted,
  fontFamily: font.mono,
  fontWeight: 400,
  fontSize: type.label,
  textAlign: "left",
  whiteSpace: "nowrap",
  borderBottom: `1px solid ${colors.border}`,
};

export const tdStyle = {
  padding: "7px 10px",
  fontFamily: font.mono,
  fontSize: 13,
  color: colors.text,
  borderBottom: `1px solid ${colors.borderSubtle}`,
};

export const chipStyle = {
  fontFamily: font.mono,
  fontSize: 11.5,
  color: colors.textMuted,
  background: colors.inset,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: radius.sm,
  padding: "1px 7px",
};
