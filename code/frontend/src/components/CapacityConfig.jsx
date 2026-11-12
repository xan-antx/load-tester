import { NumberField, LIMITS } from "./LoadTestConfig";
import { colors, space, type } from "../theme";

// "Fixed load" vs "Find capacity" and, for capacity runs, the step plan.
// The backend (analysis/capacity.py) checks the same limits.

export const CAPACITY_LIMITS = {
  start: { min: 1, max: 1000 },
  step: { min: 1, max: 1000 },
  stepSeconds: { min: 5, max: 300 },
  max: { min: 1, max: 1000 },
  totalSeconds: 300,
};

export function capacitySteps(start, step, max) {
  const steps = [];
  for (let u = start; u <= max && steps.length < 1000; u += step) steps.push(u);
  return steps;
}

export function RunModeToggle({ mode, onChange }) {
  return (
    <div role="group" aria-label="Run mode" style={{ display: "flex", gap: space.xs, marginTop: space.md }}>
      <button onClick={() => onChange("fixed")} aria-pressed={mode === "fixed"} className="toggle">
        Fixed load
      </button>
      <button onClick={() => onChange("capacity")} aria-pressed={mode === "capacity"} className="toggle">
        Find capacity
      </button>
    </div>
  );
}

export default function CapacityConfig({ plan, spawnRate, onPlanChange, onSpawnRateChange, sloReady }) {
  const steps = capacitySteps(plan.start, plan.step, plan.max);
  const total = steps.length * plan.stepSeconds;
  const tooLong = total > CAPACITY_LIMITS.totalSeconds;
  const set = (key) => (value) => onPlanChange({ ...plan, [key]: value });

  return (
    <div style={{ marginTop: space.md }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: space.md }}>
        <NumberField label="Start users" value={plan.start} limits={CAPACITY_LIMITS.start} onCommit={set("start")} />
        <NumberField label="Add users per step" value={plan.step} limits={CAPACITY_LIMITS.step} onCommit={set("step")} />
        <NumberField label="Seconds per step, 5 to 300" value={plan.stepSeconds} limits={CAPACITY_LIMITS.stepSeconds} onCommit={set("stepSeconds")} />
        <NumberField label="Max users, up to 1000" value={plan.max} limits={CAPACITY_LIMITS.max} onCommit={set("max")} />
        <NumberField label="New users per second (spawn rate), 1 to 20" value={spawnRate} limits={LIMITS.spawnRate} onCommit={onSpawnRateChange} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: space.sm, fontSize: type.body, cursor: "pointer" }}>
        <input type="checkbox" checked={plan.earlyStop} onChange={(e) => set("earlyStop")(e.target.checked)} />
        Stop after the first step that misses the SLO
      </label>
      <p style={{ margin: `${space.sm}px 0 0`, fontSize: type.meta, color: tooLong ? colors.warning : colors.textMuted }}>
        {steps.length} step{steps.length === 1 ? "" : "s"} ({steps.slice(0, 6).join(", ")}{steps.length > 6 ? ", …" : ""} users)
        × {plan.stepSeconds} s = {total} s{tooLong ? ` — longer than the ${CAPACITY_LIMITS.totalSeconds} s limit; use fewer or shorter steps.` : "."}
        {" "}Each step is judged against the SLO below. A capacity run always runs as one Locust process (it is
        never split into parallel processes).
      </p>
      {!sloReady && (
        <p style={{ margin: `${space.xs}px 0 0`, fontSize: type.meta, color: colors.warning }}>
          A capacity run needs an SLO: turn it on and set p95, average, server errors or unexpected answers.
        </p>
      )}
    </div>
  );
}
