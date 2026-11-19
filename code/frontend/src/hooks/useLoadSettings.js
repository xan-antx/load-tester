import { useState } from "react";
import { LIMITS, clampInt } from "../components/LoadTestConfig";
import { capacitySteps, CAPACITY_LIMITS } from "../components/CapacityConfig";

export const PRESETS = {
  smoke: { label: "Smoke", users: 5, spawnRate: 5, duration: 20, hint: "A quick check that everything answers." },
  normal: { label: "Normal", users: 25, spawnRate: 5, duration: 60, hint: "Everyday traffic for a minute." },
  stress: { label: "Stress", users: 150, spawnRate: 20, duration: 60, hint: "Heavy load: finds rate limits and slowdowns." },
};

// The SLO thresholds the run is judged against. Each one is on or off; an
// "off" target is not checked (and not sent to the backend).
export const SLO_FIELDS = [
  { key: "p95_ms", label: "p95 response", unit: "ms", cmp: "≤", min: 1, max: 600000, help: "95% of requests must finish within this time." },
  { key: "max_server_error_rate_pct", label: "Server errors", unit: "%", cmp: "≤", min: 0, max: 100, help: "5xx answers and requests that got no answer." },
  { key: "max_unexpected_outcome_rate_pct", label: "Wrong answers to the input", unit: "%", cmp: "≤", min: 0, max: 100, help: "Invalid input accepted (2xx) plus valid input rejected (4xx). Rate limiting is not counted." },
  { key: "avg_ms", label: "Average response", unit: "ms", cmp: "≤", min: 1, max: 600000 },
  { key: "min_rps", label: "Throughput", unit: "req/s", cmp: "≥", min: 0, max: 100000 },
];
const DEFAULT_SLO = {
  p95_ms: { on: true, value: "500" },
  max_server_error_rate_pct: { on: true, value: "1" },
  max_unexpected_outcome_rate_pct: { on: false, value: "5" },
  avg_ms: { on: false, value: "300" },
  min_rps: { on: false, value: "10" },
};

// Extra start-request fields for a capacity run (none for a fixed run).
export function modeFieldsFor(runMode, capPlan) {
  if (runMode !== "capacity") return {};
  return {
    mode: "capacity",
    spawn_rate: capPlan.spawn,
    capacity: {
      start_users: capPlan.start,
      step_users: capPlan.step,
      step_duration_seconds: capPlan.stepSeconds,
      max_users: capPlan.max,
      early_stop: capPlan.earlyStop,
    },
  };
}

export function expectedSecondsFor(runMode, capPlan, settings) {
  if (runMode === "capacity") return capacitySteps(capPlan.start, capPlan.step, capPlan.max).length * capPlan.stepSeconds;
  return settings.duration * settings.repeat;
}

export default function useLoadSettings() {
  const [preset, setPresetId] = useState("smoke");
  const [users, setUsers] = useState(PRESETS.smoke.users);
  const [spawnRate, setSpawnRate] = useState(PRESETS.smoke.spawnRate);
  const [duration, setDuration] = useState(PRESETS.smoke.duration);
  const [repeat, setRepeat] = useState(1);
  // "fixed": one load level; "capacity": step load to find the breaking point.
  const [runMode, setRunMode] = useState("fixed");
  const [capPlan, setCapPlan] = useState({ start: 20, step: 20, stepSeconds: 12, max: 200, earlyStop: true, spawn: 20 });
  const [slo, setSlo] = useState(DEFAULT_SLO);

  function setPreset(id) {
    setPresetId(id);
    const p = PRESETS[id];
    if (!p) return;
    setUsers(p.users);
    setSpawnRate(p.spawnRate);
    setDuration(p.duration);
  }
  // Editing a number by hand turns the preset into "custom".
  const custom = (setter) => (v) => {
    setter(v);
    setPresetId("custom");
  };

  const settings = () => ({
    users: clampInt(users, LIMITS.users),
    spawnRate: clampInt(spawnRate, LIMITS.spawnRate),
    duration: clampInt(duration, LIMITS.duration),
    repeat: clampInt(repeat, LIMITS.repeat),
  });

  // { key: number } of the targets that are on and valid, or undefined.
  function sloPayload() {
    const out = {};
    SLO_FIELDS.forEach(({ key }) => {
      const f = slo[key];
      const text = String(f?.value ?? "").trim();
      if (f?.on && text !== "" && Number.isFinite(Number(text))) out[key] = Number(text);
    });
    return Object.keys(out).length ? out : undefined;
  }
  const sloReady = !!sloPayload() && ["p95_ms", "avg_ms", "max_server_error_rate_pct", "max_unexpected_outcome_rate_pct"].some((k) => sloPayload()[k] != null);

  const capacitySeconds = capacitySteps(capPlan.start, capPlan.step, capPlan.max).length * capPlan.stepSeconds;
  const capacityTooLong = capacitySeconds > CAPACITY_LIMITS.totalSeconds;
  const capacityBlocked = runMode === "capacity" && (!sloReady || capacityTooLong);

  const modeFields = () => modeFieldsFor(runMode, capPlan);
  const expectedSeconds = () => expectedSecondsFor(runMode, capPlan, settings());

  function restore(config) {
    const s = config.settings || {};
    if (s.users) setUsers(s.users);
    if (s.spawnRate) setSpawnRate(s.spawnRate);
    if (s.duration) setDuration(s.duration);
    if (s.repeat) setRepeat(s.repeat);
    setRunMode(config.runMode || "fixed");
    if (config.capPlan) setCapPlan(config.capPlan);
    const match = Object.entries(PRESETS).find(([, p]) => p.users === s.users && p.spawnRate === s.spawnRate && p.duration === s.duration);
    setPresetId(match ? match[0] : "custom");
    const next = {};
    SLO_FIELDS.forEach(({ key }) => {
      const v = config.slo?.[key];
      next[key] = v != null ? { on: true, value: String(v) } : { on: false, value: DEFAULT_SLO[key].value };
    });
    setSlo(next);
  }

  return {
    preset, setPreset,
    users, setUsers: custom(setUsers),
    spawnRate, setSpawnRate: custom(setSpawnRate),
    duration, setDuration: custom(setDuration),
    repeat, setRepeat,
    runMode, setRunMode, capPlan, setCapPlan,
    slo, setSlo, sloPayload, sloReady,
    capacitySeconds, capacityTooLong, capacityBlocked,
    settings, modeFields, expectedSeconds, restore,
  };
}
