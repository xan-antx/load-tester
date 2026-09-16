import { btnStyle } from "./Section";

export default function WebsiteLoadTestSection({ sitemapRaw, onStart, starting }) {
  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={onStart} style={btnStyle} disabled={starting}>
        {starting ? "Starting..." : "Run Website Load Test"}
      </button>
      <p style={{ color: "#666", fontSize: 13, marginTop: 6 }}>
        {sitemapRaw
          ? "Will pull real pages from the sitemap and load-test them."
          : "No sitemap found — will load-test the entered page only."}
      </p>
    </div>
  );
}