// SQLite's CURRENT_TIMESTAMP stores UTC as "2026-09-16 20:13:13" with no
// timezone marker, so the browser would otherwise read it as local time.
// Turning it into ISO form ("...T20:13:13Z") makes it parse as UTC, and
// toLocaleString then shows it in the viewer's own timezone. Display only:
// sorting keeps using the raw created_at string.
export function formatTime(ts) {
  if (!ts) return "";
  const date = new Date(String(ts).replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return String(ts);
  return date.toLocaleString();
}
