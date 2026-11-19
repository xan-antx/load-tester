import { parseUtc } from "./formatTime";

// "just now", "4 min ago", "3 h ago", "yesterday", "5 days ago", or a date.
export function relativeTime(createdAt, now = Date.now()) {
  const t = parseUtc(createdAt);
  if (t == null) return "—";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString();
}
