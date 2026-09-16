import requests
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET

API_PATH_HINTS = ("/api/", "/v1/", "/v2/", "/graphql", "/rest/")
NON_PAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".css", ".js", ".xml", ".ico")


def detect_type(url: str, headers: dict) -> dict:
    content_type = headers.get("Content-Type", "").lower()
    path = urlparse(url).path.lower()

    signals = []

    if "application/json" in content_type:
        signals.append(("content_type_json", "api", 0.8))
    elif "text/html" in content_type:
        signals.append(("content_type_html", "website", 0.7))

    if any(hint in path for hint in API_PATH_HINTS):
        signals.append(("path_hint", "api", 0.6))

    api_score = sum(w for _, kind, w in signals if kind == "api")
    site_score = sum(w for _, kind, w in signals if kind == "website")

    if api_score == 0 and site_score == 0:
        classification, confidence = "unknown", 0.0
    elif api_score >= site_score:
        classification = "api"
        confidence = min(api_score, 1.0)
    else:
        classification = "website"
        confidence = min(site_score, 1.0)

    return {
        "classification": classification,
        "confidence": confidence,
        "signals": signals,
    }


def try_find_sitemap(base_url: str, timeout: float = 5.0) -> dict:
    parsed = urlparse(base_url)
    sitemap_url = urljoin(f"{parsed.scheme}://{parsed.netloc}", "/sitemap.xml")

    try:
        resp = requests.get(sitemap_url, timeout=timeout)
        if resp.status_code == 200 and "xml" in resp.headers.get("Content-Type", ""):
            return {"found": True, "sitemap_url": sitemap_url, "raw": resp.text}
        return {"found": False, "sitemap_url": sitemap_url}
    except requests.exceptions.RequestException:
        return {"found": False, "sitemap_url": sitemap_url, "error": "unreachable"}


def _local_tag(tag: str) -> str:
    """Strips XML namespace prefix, e.g. '{http://...}urlset' -> 'urlset'."""
    return tag.split("}")[-1] if "}" in tag else tag


def _looks_like_page(path: str) -> bool:
    """Filters out obvious non-page assets (images, stylesheets, etc.)
    that sometimes end up in sitemaps alongside real pages."""
    return not any(path.lower().endswith(ext) for ext in NON_PAGE_EXTENSIONS)


def extract_paths_from_sitemap(sitemap_xml: str, max_paths: int = 20, _depth: int = 0, timeout: float = 5.0) -> list:
    """
    Parses a sitemap.xml and returns real page paths (e.g. '/about').

    Handles two cases:
    - A regular sitemap (<urlset>): <loc> entries are real pages.
    - A sitemap index (<sitemapindex>): <loc> entries point to OTHER
      sitemap files, not pages themselves — we fetch a few of those
      sub-sitemaps and extract real page paths from them instead.

    Non-page assets (images, CSS, JS, etc.) are filtered out, since
    sitemaps sometimes bundle these alongside real pages.

    _depth caps recursion at one level.
    """
    try:
        root = ET.fromstring(sitemap_xml)
    except ET.ParseError:
        return []

    root_tag = _local_tag(root.tag)
    loc_elements = [el for el in root.iter() if _local_tag(el.tag) == "loc"]
    urls = [(el.text or "").strip() for el in loc_elements if el.text]

    if root_tag == "sitemapindex":
        if _depth >= 1:
            return []

        collected_paths = []
        for sub_sitemap_url in urls[:5]:
            try:
                resp = requests.get(sub_sitemap_url, timeout=timeout)
                if resp.status_code == 200:
                    sub_paths = extract_paths_from_sitemap(
                        resp.text, max_paths=max_paths, _depth=_depth + 1, timeout=timeout
                    )
                    collected_paths.extend(sub_paths)
            except requests.exceptions.RequestException:
                continue
            if len(collected_paths) >= max_paths:
                break

        return collected_paths[:max_paths]

    paths = []
    for url_text in urls:
        p = urlparse(url_text).path or "/"
        if _looks_like_page(p):
            paths.append(p)
        if len(paths) >= max_paths:
            break
    return paths