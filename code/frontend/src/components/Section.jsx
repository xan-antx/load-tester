import { colors, font, space } from "../theme";

export default function Section({ title, children }) {
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: space.xl,
        marginTop: space.lg,
        background: colors.surface,
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: space.lg, fontSize: 16, fontWeight: 600, color: colors.text }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

export const btnStyle = {
  marginTop: space.sm,
  padding: "9px 18px",
  background: colors.accent,
  color: colors.bg,
  border: "none",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  transition: "background 0.15s ease",
};

export const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  boxSizing: "border-box",
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: 7,
  color: colors.text,
  fontSize: 14,
  fontFamily: font.mono,
};

export const preStyle = {
  background: colors.surfaceRaised,
  border: `1px solid ${colors.borderSubtle}`,
  padding: space.md,
  borderRadius: 7,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  marginTop: space.sm,
  maxHeight: 400,
  overflowY: "auto",
  color: colors.textMuted,
  fontFamily: font.mono,
  fontSize: 12.5,
  lineHeight: 1.6,
};

export const thStyle = {
  padding: "8px 10px",
  color: colors.textMuted,
  fontWeight: 600,
  fontSize: 12,
  textTransform: "none",
};

export const tdStyle = {
  padding: "8px 10px",
  fontFamily: font.mono,
  fontSize: 13,
  color: colors.text,
};