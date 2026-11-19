import { useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon";
import { colors, radius, space, type, z } from "../theme";

// A "?" button that opens a short explanation next to it. Replaces
// title-only tooltips: it works with keyboard, touch and screen readers.
// Esc or a click outside closes it; focus returns to the button.
export default function Popover({ label, children, width = 320, align = "start" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="help" size={16} />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="popover"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            [align === "end" ? "right" : "left"]: 0,
            zIndex: z.overlay,
            width: `min(${width}px, calc(100vw - ${space.xl}px))`,
            padding: `${space.md}px ${space.lg}px`,
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            color: colors.text,
            fontSize: type.body,
            fontWeight: 400,
            lineHeight: 1.5,
            textAlign: "left",
            whiteSpace: "normal",
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
