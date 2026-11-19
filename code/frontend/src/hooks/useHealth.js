import { useEffect, useState } from "react";

const HEALTH_POLL_MS = 15000;

// "checking" | "online" | "offline", from GET {apiBase}/api/health every 15 s.
// recheck() runs a check now (used by the offline banner's "Try again").
export default function useHealth(apiBase) {
  const [health, setHealth] = useState("checking");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const resp = await fetch(`${apiBase}/api/health`);
        if (!cancelled) setHealth(resp.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setHealth("offline");
      }
    }
    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiBase, nonce]);

  return { health, recheck: () => setNonce((n) => n + 1), markOffline: () => setHealth("offline") };
}
