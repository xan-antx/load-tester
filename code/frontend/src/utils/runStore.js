// Remembers, in this browser only, how each run was configured: the full
// target URL, the cases with their payloads, the load settings and the SLO.
// The backend stores neither the URL path nor the payloads, and the results
// screen needs both (to name the payload behind a bug, and for "Re-run").
// Header values are never stored. Storage can be unavailable (private mode,
// blocked site data), so every access is guarded and failure means "unknown".

const KEY = "elevate.runConfigs.v1";
const MAX_ENTRIES = 50;

function readAll() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveRunConfig(runId, config) {
  if (!runId) return;
  try {
    const all = readAll();
    all[runId] = { ...config, savedAt: Date.now() };
    const ids = Object.keys(all).sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0));
    ids.slice(MAX_ENTRIES).forEach((id) => delete all[id]);
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not stored: the run still works, it just shows case names only.
  }
}

export function loadRunConfig(runId) {
  if (!runId) return null;
  return readAll()[runId] || null;
}

export function loadAllRunConfigs() {
  return readAll();
}
