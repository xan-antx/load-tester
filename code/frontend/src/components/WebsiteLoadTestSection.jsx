import { colors, font, space, type } from "../theme";

export default function WebsiteLoadTestSection({ sitemapRaw, onStart, starting, testRunning, targetUrl }) {
  return (
    <div style={{ marginTop: space.md }}>
      <button onClick={onStart} className="btn btn-primary" disabled={starting || testRunning}>
        {testRunning ? "Test in progress…" : starting ? "Starting…" : "Run website load test"}
      </button>
      <p style={{ color: colors.textMuted, fontSize: type.meta, marginTop: space.sm }}>
        {sitemapRaw
          ? "Pulls real pages from the sitemap of "
          : "No sitemap found, so only this page is tested: "}
        <span style={{ fontFamily: font.mono, color: colors.text, wordBreak: "break-all" }}>{targetUrl}</span>
      </p>
    </div>
  );
}
