// Backend access shared by the hooks. The API contracts are unchanged; this
// only centralises the base URL and the error wording.

export const BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

// Shown when a request fails before any response arrives.
export function networkError() {
  return `The backend did not answer. Check that it is running at ${BASE}, then try again.`;
}

// Backend errors come back as {error: "..."}; show that sentence rather than
// the raw JSON, and fall back to the JSON only when there is nothing else.
export function describeError(data, fallback) {
  if (data?.error) return data.error;
  if (data?.reason) return data.reason;
  return data ? `${fallback}: ${JSON.stringify(data)}` : fallback;
}

// fetch + JSON. Resolves to {ok, status, data}; throws only on a network
// failure (no response at all), with err.network = true.
export async function request(path, { method = "GET", body } = {}) {
  let resp;
  try {
    resp = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    err.network = true;
    throw err;
  }
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data };
}
