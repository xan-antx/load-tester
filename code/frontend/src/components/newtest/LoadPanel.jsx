import { useId } from "react";
import Icon from "../Icon";
import Popover from "../Popover";
import { NumberField, LIMITS } from "../LoadTestConfig";
import CapacityConfig from "../CapacityConfig";
import { PRESETS, SLO_FIELDS } from "../../hooks/useLoadSettings";
import { estimateRun } from "../../utils/estimate";

function SloFields({ load }) {
  const set = (key, patch) => load.setSlo((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  return (
    <fieldset className="panel-group">
      <legend className="panel-title">
        Performance targets (SLO)
        <Popover label="What is an SLO?" align="end">
          A service-level objective is a promise about performance, such as "95% of requests answer within 500
          ms". Every target that is on is checked after the run, which then gets PASS or FAIL. Targets that are
          off are not checked.
        </Popover>
      </legend>
      <ul className="slo-fields">
        {SLO_FIELDS.map((f) => {
          const v = load.slo[f.key];
          const id = `slo-${f.key}`;
          return (
            <li key={f.key} className={v.on ? undefined : "is-off"}>
              <label className="switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={v.on}
                  onChange={(e) => set(f.key, { on: e.target.checked })}
                  aria-describedby={f.help ? `${id}-help` : undefined}
                />
                <span className="switch-text">{f.label}</span>
              </label>
              {v.on ? (
                <span className="slo-input">
                  <span className="cmp">{f.cmp}</span>
                  <input
                    id={id}
                    type="number"
                    className="input mono"
                    min={f.min}
                    max={f.max}
                    step="any"
                    value={v.value}
                    aria-label={`${f.label} target in ${f.unit}`}
                    onChange={(e) => set(f.key, { value: e.target.value })}
                  />
                  <span className="unit">{f.unit}</span>
                </span>
              ) : (
                <span className="off-tag">not checked</span>
              )}
              {f.help && <span id={`${id}-help`} className="visually-hidden">{f.help}</span>}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

// The sticky right column of New test: how hard to push, what counts as
// good, and the one primary action of the screen.
export default function LoadPanel({ load, caseCount, isWebsite, startState, onStart }) {
  const blockedId = useId();
  const s = load.settings();
  const est = estimateRun({
    mode: load.runMode,
    users: s.users,
    spawnRate: s.spawnRate,
    duration: s.duration,
    capPlan: load.capPlan,
    caseCount: isWebsite ? 0 : caseCount,
  });
  const riskyCases = !isWebsite && caseCount > 0 && est.untested >= 0.5 ? Math.max(1, Math.round(est.untested)) : 0;
  const { blockers, starting, running, error, busy } = startState;

  return (
    <aside className="load-panel" aria-label="Load and start">
      <div className="panel-group">
        <div className="panel-title">Load</div>
        <div role="group" aria-label="Run mode" className="segmented is-full">
          <button type="button" aria-pressed={load.runMode === "fixed"} onClick={() => load.setRunMode("fixed")}>Fixed load</button>
          <button type="button" aria-pressed={load.runMode === "capacity"} onClick={() => load.setRunMode("capacity")}>Find capacity</button>
        </div>

        {load.runMode === "fixed" ? (
          <>
            <div role="group" aria-label="Preset" className="preset-row">
              {[...Object.entries(PRESETS), ["custom", { label: "Custom" }]].map(([id, p]) => (
                <button key={id} type="button" className="preset" aria-pressed={load.preset === id} onClick={() => load.setPreset(id)} title={p.hint}>
                  {p.label}
                </button>
              ))}
            </div>
            {PRESETS[load.preset] && <p className="panel-hint">{PRESETS[load.preset].hint}</p>}
            <div className="field-grid">
              <NumberField compact label="Users" value={load.users} limits={LIMITS.users} onCommit={load.setUsers} />
              <NumberField compact label="Start per second" value={load.spawnRate} limits={LIMITS.spawnRate} onCommit={load.setSpawnRate} />
              <NumberField compact label="Seconds" value={load.duration} limits={LIMITS.duration} onCommit={load.setDuration} />
              <NumberField compact label="Repeat" value={load.repeat} limits={LIMITS.repeat} onCommit={load.setRepeat} />
            </div>
            <p className="panel-hint">
              Users are simulated people sending requests in a loop; "start per second" is how fast they join
              (the ramp-up, also called spawn rate).
            </p>
          </>
        ) : (
          <CapacityConfig
            plan={load.capPlan}
            spawnRate={load.capPlan.spawn}
            onPlanChange={load.setCapPlan}
            onSpawnRateChange={(spawn) => load.setCapPlan((p) => ({ ...p, spawn }))}
            sloReady={load.sloReady}
          />
        )}

        <div className="estimate" aria-live="polite">
          <div>
            Sends about <strong className="num">{est.requests.toLocaleString()}</strong> requests
            {!isWebsite && caseCount > 0 && (
              <>, about <strong className="num">{est.perCase < 10 ? est.perCase.toFixed(1) : Math.round(est.perCase)}</strong> per case</>
            )}
            {s.repeat > 1 && load.runMode === "fixed" ? <>, in each of {s.repeat} runs</> : null}.
          </div>
          {riskyCases > 0 && (
            <div className="estimate-warn" role="status">
              <Icon name="alert" size={14} />
              <span>
                About <strong>{riskyCases} of {caseCount} cases</strong> may never be sent at this load. Raise the
                seconds or the users so every case is tested.
              </span>
            </div>
          )}
        </div>
      </div>

      <SloFields load={load} />

      <div className="start-block">
        <button
          type="button"
          className="btn btn-primary btn-start"
          onClick={onStart}
          disabled={blockers.length > 0 || starting || running}
          aria-describedby={blockers.length ? blockedId : undefined}
        >
          <Icon name="play" />
          {running ? "A test is running…" : starting ? "Starting…" : isWebsite ? "Start website test" : "Start load test"}
        </button>
        {blockers.length > 0 && !running && (
          <ul id={blockedId} className="blockers">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="field-error">
            <Icon name="alert" size={14} /> {error}
          </p>
        )}
        {busy && (
          <p role="status" className="field-note">
            Server busy: {busy}
          </p>
        )}
      </div>
    </aside>
  );
}
