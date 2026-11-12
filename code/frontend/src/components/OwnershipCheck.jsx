import { colors, space, type } from "../theme";

// The confirmation every load test needs (the backend refuses a start
// request without "i_own_target": true). Shown right above the start buttons.
export default function OwnershipCheck({ id, checked, onChange }) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: space.sm,
        marginTop: space.md,
        fontSize: type.body,
        color: colors.text,
        cursor: "pointer",
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ transform: "translateY(3px)" }}
      />
      <span>
        I own this target or have permission to load-test it
        <span style={{ display: "block", fontSize: type.meta, color: colors.textMuted }}>
          A load test sends many requests at once; only test servers you are allowed to.
        </span>
      </span>
    </label>
  );
}
