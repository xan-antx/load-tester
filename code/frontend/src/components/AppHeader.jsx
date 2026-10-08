import { useEffect, useState } from "react";
import { colors, font, space, type } from "../theme";

const HEALTH_POLL_MS = 15000;

// Product name, tagline, and a backend connection light driven by
// GET {apiBase}/api/health every 15 seconds.
export default function AppHeader({ apiBase }) {
  const [health, setHealth] = useState("checking"); // checking | online | offline

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
  }, [apiBase]);

  const light = {
    checking: { color: colors.textFaint, text: "Checking backend…" },
    online: { color: colors.success, text: "Connected" },
    offline: { color: colors.danger, text: "Backend offline" },
  }[health];

  return (
    <header
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: `${space.sm}px ${space.lg}px`,
        padding: `${space.lg}px 0`,
        marginBottom: space.lg,
        borderBottom: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: space.md, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: type.title, fontWeight: 600, letterSpacing: "0.01em" }}>
          Elevate Load Tester
        </h1>
        <span className="header-tagline" style={{ fontSize: type.meta, color: colors.textMuted }}>
          Finds the inputs your API mishandles, and the load at which it starts to fail.
        </span>
      </div>
      <div
        role="status"
        aria-live="polite"
        title={`${apiBase}/api/health, checked every 15 s`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: space.sm,
          fontFamily: font.mono,
          fontSize: type.meta,
          color: health === "offline" ? colors.danger : colors.textMuted,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: light.color }} />
        {light.text}
      </div>
    </header>
  );
}
