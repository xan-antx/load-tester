import { useState } from "react";
import { request, networkError } from "../api";
import { headersObject } from "../components/RequestHeadersEditor";

const DEFAULT_URL = import.meta.env.VITE_DEFAULT_TARGET || "http://127.0.0.1:8000/api/login";

// The target URL, its analysis, the ownership confirmation and the optional
// request headers. onNewTarget() runs when a different URL is analyzed, so
// cases built for the old target are dropped.
export default function useTarget({ onNewTarget, onNetworkError } = {}) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [analyzeResult, setAnalyzeResult] = useState(null);
  // The URL the last analysis ran on. Tests start only while the field still
  // holds it, so cases built for one target are never sent to another.
  const [analyzedUrl, setAnalyzedUrl] = useState(null);
  const [kind, setKind] = useState(null); // "api" | "website" | null
  const [sitemapRaw, setSitemapRaw] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [ownTarget, setOwnTarget] = useState(false);
  // Optional request headers: [{id, name, value}]. Kept in memory only.
  const [requestHeaders, setRequestHeaders] = useState([]);

  async function analyze() {
    setError(null);
    const trimmed = url.trim();
    if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
      setError("Enter a full URL starting with http:// or https://, for example http://127.0.0.1:8000/api/login");
      return;
    }
    setAnalyzing(true);
    setAnalyzeResult(null);
    setSitemapRaw(null);
    try {
      const { ok, data } = await request("/api/analyze", { method: "POST", body: { url, headers: headersObject(requestHeaders) } });
      setAnalyzeResult(data);
      if (url !== analyzedUrl) {
        setOwnTarget(false);
        onNewTarget?.();
      }
      setAnalyzedUrl(url);
      const classification = data?.type_detection?.classification;
      setKind(ok && (classification === "api" || classification === "website") ? classification : null);
      if (data?.sitemap?.raw) setSitemapRaw(data.sitemap.raw);
      if (!ok) setError(data?.error || "Could not reach or analyze that URL.");
    } catch {
      setError(networkError());
      onNetworkError?.();
    } finally {
      setAnalyzing(false);
    }
  }

  // Restores a stored run's target without a new analysis (Edit and re-run).
  function restore(config) {
    setUrl(config.url);
    setAnalyzedUrl(config.url);
    setKind(config.kind === "website" ? "website" : "api");
    setAnalyzeResult(null);
    setError(null);
    setOwnTarget(false);
  }

  const targetChanged = analyzedUrl !== null && url !== analyzedUrl;

  return {
    url, setUrl, analyze, analyzing, analyzeResult, analyzedUrl, kind,
    isApi: kind === "api" && !targetChanged,
    isWebsite: kind === "website" && !targetChanged,
    sitemapRaw, targetChanged, error, setError,
    ownTarget, setOwnTarget, requestHeaders, setRequestHeaders, restore,
  };
}
