import { useEffect, useId, useState } from "react";
import { colors, space, type } from "../theme";
import { inputStyle as themeInputStyle, labelStyle } from "./Section";

export const LIMITS = {
  users: { min: 1, max: 1000 },
  spawnRate: { min: 1, max: 20 },
  duration: { min: 1, max: 300 },
  repeat: { min: 1, max: 5 },
};

// Turns whatever is in a field into a whole number inside the range.
// Empty or non-numeric input falls back to the minimum.
export function clampInt(value, { min, max }) {
  const n = Math.trunc(Number(value));
  if (value === "" || value === null || !Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

// The text is kept locally while typing (so the field can be empty for a
// moment); the parent only receives a clamped integer on blur or Enter.
export function NumberField({ label, value, limits, onCommit }) {
  const [text, setText] = useState(String(value));
  // Set when the typed value had to be changed, so the user sees why.
  const [note, setNote] = useState(null);
  const noteId = useId();

  // Both config blocks share the same parent value; follow it when it changes.
  // (The local text exists so a field can be empty while typing.)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(String(value));
  }, [value]);

  function commit() {
    const n = clampInt(text, limits);
    if (String(n) !== text.trim()) {
      if (text.trim() === "" || !Number.isFinite(Number(text))) setNote(`Not a number, set to ${n}`);
      else if (Number(text) > limits.max) setNote(`Set to ${n}, the maximum`);
      else if (Number(text) < limits.min) setNote(`Set to ${n}, the minimum`);
      else setNote(`Rounded to ${n}`);
    } else {
      setNote(null);
    }
    setText(String(n));
    onCommit(n);
  }

  return (
    <div style={{ flex: "1 1 160px" }}>
      <label>
        <span style={labelStyle}>{label}</span>
        <input
          type="number"
          min={limits.min}
          max={limits.max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          aria-describedby={note ? noteId : undefined}
          style={inputStyle}
        />
      </label>
      <span id={noteId} role="status" style={{ display: "block", minHeight: 18, fontSize: type.meta, color: colors.warning }}>
        {note}
      </span>
    </div>
  );
}

export default function LoadTestConfig({
  users,
  spawnRate,
  duration,
  repeat,
  onUsersChange,
  onSpawnRateChange,
  onDurationChange,
  onRepeatChange,
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space.md, marginTop: space.md, marginBottom: space.sm }}>
      <NumberField label="Users, 1 to 1000" value={users} limits={LIMITS.users} onCommit={onUsersChange} />
      <NumberField label="New users per second (spawn rate), 1 to 20" value={spawnRate} limits={LIMITS.spawnRate} onCommit={onSpawnRateChange} />
      <NumberField label="Duration in seconds, 1 to 300" value={duration} limits={LIMITS.duration} onCommit={onDurationChange} />
      <NumberField label="Repeat, 1 to 5 (runs back to back)" value={repeat} limits={LIMITS.repeat} onCommit={onRepeatChange} />
    </div>
  );
}

const inputStyle = {
  ...themeInputStyle,
  padding: `${space.sm}px ${space.md}px`,
};
