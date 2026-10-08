import { btnStyle, withDisabled } from "./Section";
import { colors, space, type } from "../theme";

export default function WebsiteLoadTestSection({ sitemapRaw, onStart, starting, testRunning }) {
  return (
    <div style={{ marginTop: space.md }}>
      <button onClick={onStart} style={withDisabled(btnStyle, starting || testRunning)} disabled={starting || testRunning}>
        {testRunning ? "Test in progress…" : starting ? "Starting..." : "Run Website Load Test"}
      </button>
      <p style={{ color: colors.textMuted, fontSize: type.small, marginTop: space.sm }}>
        {sitemapRaw
          ? "Will pull real pages from the sitemap and load-test them."
          : "No sitemap found — will load-test the entered page only."}
      </p>
    </div>
  );
}
