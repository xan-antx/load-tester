import { STEP_STATES } from "./Section";
import { colors, font, radius, space, type } from "../theme";

// Navigation only: clicking a step scrolls to it; it never hides sections.
// steps: [{ n, label, state, available, targetId }]
export default function StepRail({ steps }) {
  function go(targetId) {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(targetId)?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }

  return (
    <nav className="step-rail" aria-label="Workflow steps">
      {steps.map((s) => {
        const st = STEP_STATES[s.state] || STEP_STATES.pending;
        const active = s.state === "active";
        const done = s.state === "done";
        return (
          <button
            key={s.n}
            onClick={() => s.available && go(s.targetId)}
            disabled={!s.available}
            aria-current={active ? "step" : undefined}
            className="rail-item"
            aria-label={`Step ${s.n}: ${s.label} — ${st.label}`}
            title={`${s.label} — ${st.label}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: space.sm,
              padding: space.sm,
              background: active ? colors.accentSoft : undefined,
              border: "none",
              borderLeft: `2px solid ${active ? colors.accent : "transparent"}`,
              borderRadius: radius.sm,
              color: s.available || done ? colors.text : colors.textFaint,
              cursor: s.available ? "pointer" : "default",
              textAlign: "left",
            }}
          >
            <span
              style={{
                flex: "none",
                width: 22,
                height: 22,
                display: "inline-grid",
                placeItems: "center",
                borderRadius: "50%",
                border: `1px solid ${done || active ? colors.accent : colors.border}`,
                color: done || active ? colors.accent : colors.textMuted,
                fontFamily: font.mono,
                fontSize: type.meta,
              }}
            >
              {done ? "✓" : s.n}
            </span>
            <span className="rail-text" style={{ lineHeight: 1.25 }}>
              <span style={{ fontSize: type.body, fontWeight: active ? 600 : 500 }}>{s.label}</span>
              <span style={{ fontFamily: font.mono, fontSize: type.meta, color: st.color }}>{st.label}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
