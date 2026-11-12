import { colors, font, space, type } from "../theme";
import OwnershipCheck from "./OwnershipCheck";

export default function WebsiteLoadTestSection({
  sitemapRaw, onStart, starting, testRunning, targetUrl, ownTarget, onOwnTargetChange, blocked = false,
}) {
  return (
    <div style={{ marginTop: space.md }}>
      <OwnershipCheck id="own-target-website" checked={ownTarget} onChange={onOwnTargetChange} />
      <button
        onClick={onStart}
        className="btn btn-primary"
        style={{ marginTop: space.sm }}
        disabled={starting || testRunning || !ownTarget || blocked}
      >
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
