//! Media pipeline commands: image asset storage, link previews, image fetch.
//!
//! Design contract (docs/design/block-editor.md §3, script-language.md):
//! - Rust stays "dumb" about the database — it only touches the filesystem
//!   under `app_data_dir/assets/` and the network. The JS side records the
//!   `assets` table row (the sql plugin owns the DB from JS).
//! - All outbound fetches are https-only with a private-IP / localhost SSRF
//!   guard (mirrored in TS at `src/editor/media/urlGuard.ts` — keep in sync),
//!   5 s timeout, and hard byte caps.

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
/// Cap for fetched HTML documents (link previews) and API responses.
const PAGE_CAP: usize = 512 * 1024;
/// Cap for a link preview's og:image download.
const OG_IMAGE_CAP: usize = 300 * 1024;
/// Cap for favicons.
const FAVICON_CAP: usize = 64 * 1024;
/// Cap for each Openverse image download.
const FETCHED_IMAGE_CAP: usize = 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const USER_AGENT: &str = "Bellanote/0.1 (+https://github.com/AkshitIreddy/bellanote)";

// ---------------------------------------------------------------------------
// Result types (camelCase over IPC)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAsset {
    /// Stable content-derived id, e.g. `img_9f2ab04c11aa72de`.
    pub id: String,
    /// Path relative to `app_data_dir/assets/`, e.g. `images/9f2a….png`.
    pub rel_path: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_data_uri: Option<String>,
    pub favicon_data_uri: Option<String>,
    pub site_name: Option<String>,
    /// Set when metadata could not be fetched — the card falls back to a
    /// plain link. Never an Err over IPC: failure is a valid preview state.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedImage {
    /// Content-derived asset id (same shape `save_image_asset` returns).
    pub id: String,
    /// Local path relative to the assets root — the JS side records the
    /// assets row and resolves a displayable src from this.
    pub rel_path: String,
    /// Original remote image URL (kept for provenance / re-fetch).
    pub url: String,
    pub thumb_url: Option<String>,
    pub attribution: String,
    pub license: String,
}

// ---------------------------------------------------------------------------
// URL guard (SSRF)
// ---------------------------------------------------------------------------

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_ipv4(v4),
        IpAddr::V6(v6) => is_private_ipv6(v6),
    }
}

fn is_private_ipv4(v4: &Ipv4Addr) -> bool {
    let o = v4.octets();
    v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_documentation()
        || o[0] == 0
        // CGNAT 100.64.0.0/10
        || (o[0] == 100 && (64..128).contains(&o[1]))
        // IETF protocol assignments 192.0.0.0/24
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
}

fn is_private_ipv6(v6: &Ipv6Addr) -> bool {
    let seg = v6.segments();
    v6.is_loopback()
        || v6.is_unspecified()
        // unique local fc00::/7
        || (seg[0] & 0xfe00) == 0xfc00
        // link local fe80::/10
        || (seg[0] & 0xffc0) == 0xfe80
        || v6
            .to_ipv4_mapped()
            .map(|m| is_private_ipv4(&m))
            .unwrap_or(false)
}

/// Hostname-level block: localhost-ish names and private/reserved IP literals.
fn is_blocked_host(host: &str) -> bool {
    let h = host
        .trim_end_matches('.')
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if h.is_empty()
        || h == "localhost"
        || h.ends_with(".localhost")
        || h.ends_with(".local")
        || h.ends_with(".internal")
        || h.ends_with(".home.arpa")
        || !h.contains('.') && h.parse::<IpAddr>().is_err()
    {
        return true;
    }
    if let Ok(ip) = h.parse::<IpAddr>() {
        return is_private_ip(&ip);
    }
    false
}

/// Parse + validate a URL for outbound fetching: https-only, public host.
fn check_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "invalid URL".to_string())?;
    if url.scheme() != "https" {
        return Err("only https URLs can be fetched".to_string());
    }
    let host = url.host_str().ok_or_else(|| "URL has no host".to_string())?;
    if is_blocked_host(host) {
        return Err("URL points at a local or private address".to_string());
    }
    Ok(url)
}

/// DNS-resolve the host and reject if any resolved address is private.
/// (Best-effort: reqwest re-resolves, but a plain hostname pointing at
/// 127.0.0.1 is caught here.)
async fn resolve_guard(url: &reqwest::Url) -> Result<(), String> {
    let host = url.host_str().unwrap_or_default().to_string();
    if host.parse::<IpAddr>().is_ok() {
        return Ok(()); // literal already vetted by check_url
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|iter| iter.map(|a| a.ip()).collect::<Vec<_>>())
            .map_err(|e| format!("DNS lookup failed: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    if addrs.is_empty() {
        return Err("DNS lookup returned no addresses".to_string());
    }
    if addrs.iter().any(is_private_ip) {
        return Err("host resolves to a private address".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// HTTP client + capped download
// ---------------------------------------------------------------------------

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .connect_timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > MAX_REDIRECTS {
                return attempt.error("too many redirects");
            }
            let safe = attempt.url().scheme() == "https"
                && attempt
                    .url()
                    .host_str()
                    .map(|h| !is_blocked_host(h))
                    .unwrap_or(false);
            if safe {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

struct Downloaded {
    bytes: Vec<u8>,
    content_type: Option<String>,
}

/// GET `url` enforcing the byte `cap` while streaming (content-length header
/// is checked first, then the body is re-checked chunk by chunk).
async fn download_capped(
    client: &reqwest::Client,
    url: reqwest::Url,
    cap: usize,
) -> Result<Downloaded, String> {
    resolve_guard(&url).await?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    if let Some(len) = resp.content_length() {
        if len as usize > cap {
            return Err(format!("response too large ({len} bytes, cap {cap})"));
        }
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or("").trim().to_string());
    let mut bytes: Vec<u8> = Vec::new();
    let mut resp = resp;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("read failed: {e}"))? {
        if bytes.len() + chunk.len() > cap {
            return Err(format!("response exceeded cap of {cap} bytes"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Downloaded {
        bytes,
        content_type,
    })
}

// ---------------------------------------------------------------------------
// Content sniffing, hashing, base64
// ---------------------------------------------------------------------------

/// Sniff an image extension from magic bytes; None if unrecognized.
fn sniff_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.len() >= 12 && &bytes[4..12] == b"ftypavif" {
        return Some("avif");
    }
    // SVG: text starting with an XML/svg tag (allow BOM + whitespace).
    let head = &bytes[..bytes.len().min(256)];
    if let Ok(text) = std::str::from_utf8(head.strip_prefix(&[0xef, 0xbb, 0xbf][..]).unwrap_or(head))
    {
        let t = text.trim_start();
        if t.starts_with("<svg") || t.starts_with("<?xml") {
            return Some("svg");
        }
    }
    None
}

fn mime_for_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Lowercase, alphanumeric, ≤5 chars; jpeg→jpg; fallback "bin".
fn sanitize_extension(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(5)
        .collect::<String>()
        .to_ascii_lowercase();
    match cleaned.as_str() {
        "" => "bin".to_string(),
        "jpeg" => "jpg".to_string(),
        _ => cleaned,
    }
}

/// FNV-1a 64-bit — deterministic content hash for filenames/dedup
/// (not cryptographic; collision odds are fine for a personal notes app).
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

const BASE64_TABLE: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(BASE64_TABLE[(n >> 18 & 0x3f) as usize] as char);
        out.push(BASE64_TABLE[(n >> 12 & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 {
            BASE64_TABLE[(n >> 6 & 0x3f) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_TABLE[(n & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn data_uri(bytes: &[u8], content_type: Option<&str>) -> String {
    let mime = match content_type {
        Some(ct) if ct.starts_with("image/") => ct.to_string(),
        _ => mime_for_extension(sniff_extension(bytes).unwrap_or("bin")).to_string(),
    };
    format!("data:{mime};base64,{}", base64_encode(bytes))
}

// ---------------------------------------------------------------------------
// Asset storage (filesystem only — DB rows are the JS side's job)
// ---------------------------------------------------------------------------

fn assets_images_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    Ok(base.join("assets").join("images"))
}

fn save_bytes_as_asset(
    app: &tauri::AppHandle,
    bytes: &[u8],
    suggested_ext: &str,
) -> Result<SavedAsset, String> {
    if bytes.is_empty() {
        return Err("empty image data".to_string());
    }
    let ext = sniff_extension(bytes)
        .map(str::to_string)
        .unwrap_or_else(|| sanitize_extension(suggested_ext));
    let hash = fnv1a64(bytes);
    let file_name = format!("{hash:016x}.{ext}");
    let dir = assets_images_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create assets dir: {e}"))?;
    let path = dir.join(&file_name);
    if !path.exists() {
        std::fs::write(&path, bytes).map_err(|e| format!("cannot write asset: {e}"))?;
    }
    Ok(SavedAsset {
        id: format!("img_{hash:016x}"),
        rel_path: format!("images/{file_name}"),
    })
}

// ---------------------------------------------------------------------------
// Link preview metadata extraction (pure — testable without network)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, PartialEq)]
struct PageMeta {
    title: Option<String>,
    description: Option<String>,
    site_name: Option<String>,
    image_url: Option<String>,
    favicon_url: Option<String>,
}

fn non_empty(s: String) -> Option<String> {
    let t = s.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// Extract og:/twitter:/standard metadata from an HTML document.
/// `scraper::Html` is !Send, so this runs fully synchronously and returns
/// owned strings before any await point.
fn extract_page_meta(html: &str, base: &reqwest::Url) -> PageMeta {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);
    let sel = |s: &str| Selector::parse(s).expect("static selector");

    let meta_content = |selectors: &[&str]| -> Option<String> {
        for s in selectors {
            for el in doc.select(&sel(s)) {
                if let Some(content) = el.value().attr("content") {
                    if let Some(v) = non_empty(content.to_string()) {
                        return Some(v);
                    }
                }
            }
        }
        None
    };

    let title = meta_content(&[
        "meta[property=\"og:title\"]",
        "meta[name=\"twitter:title\"]",
    ])
    .or_else(|| {
        doc.select(&sel("title"))
            .next()
            .and_then(|el| non_empty(el.text().collect::<String>()))
    });

    let description = meta_content(&[
        "meta[property=\"og:description\"]",
        "meta[name=\"twitter:description\"]",
        "meta[name=\"description\"]",
    ]);

    let site_name = meta_content(&["meta[property=\"og:site_name\"]"]);

    let image_url = meta_content(&[
        "meta[property=\"og:image\"]",
        "meta[property=\"og:image:url\"]",
        "meta[name=\"twitter:image\"]",
    ])
    .and_then(|raw| base.join(raw.trim()).ok())
    .map(|u| u.to_string());

    let favicon_url = doc
        .select(&sel("link[rel~=\"icon\"], link[rel=\"shortcut icon\"], link[rel=\"apple-touch-icon\"]"))
        .find_map(|el| el.value().attr("href"))
        .and_then(|href| base.join(href.trim()).ok())
        .map(|u| u.to_string())
        .or_else(|| base.join("/favicon.ico").ok().map(|u| u.to_string()));

    PageMeta {
        title,
        description,
        site_name,
        image_url,
        favicon_url,
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Write image bytes under `app_data_dir/assets/images/<contenthash>.<ext>`.
/// Filesystem only — the caller records the `assets` table row.
#[tauri::command]
pub async fn save_image_asset(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    suggested_ext: String,
) -> Result<SavedAsset, String> {
    tauri::async_runtime::spawn_blocking(move || save_bytes_as_asset(&app, &bytes, &suggested_ext))
        .await
        .map_err(|e| e.to_string())?
}

/// Fetch og:/twitter:/title metadata for a URL. Never an IPC error on fetch
/// failure — returns a `LinkPreview` with `error` set so the UI can fall
/// back to a plain link card.
#[tauri::command]
pub async fn fetch_link_preview(url: String) -> LinkPreview {
    match fetch_link_preview_inner(&url).await {
        Ok(preview) => preview,
        Err(error) => LinkPreview {
            url,
            error: Some(error),
            ..LinkPreview::default()
        },
    }
}

async fn fetch_link_preview_inner(raw_url: &str) -> Result<LinkPreview, String> {
    let url = check_url(raw_url)?;
    let client = http_client()?;

    let page = download_capped(&client, url.clone(), PAGE_CAP).await?;
    if let Some(ct) = &page.content_type {
        if !ct.contains("html") && !ct.contains("xml") {
            return Err(format!("not an HTML page ({ct})"));
        }
    }
    let html = String::from_utf8_lossy(&page.bytes).into_owned();
    let meta = extract_page_meta(&html, &url); // sync scope: Html is !Send

    let mut image_data_uri = None;
    if let Some(img) = &meta.image_url {
        if let Ok(img_url) = check_url(img) {
            if let Ok(dl) = download_capped(&client, img_url, OG_IMAGE_CAP).await {
                if !dl.bytes.is_empty() {
                    image_data_uri = Some(data_uri(&dl.bytes, dl.content_type.as_deref()));
                }
            }
        }
    }

    let mut favicon_data_uri = None;
    if let Some(fav) = &meta.favicon_url {
        if let Ok(fav_url) = check_url(fav) {
            if let Ok(dl) = download_capped(&client, fav_url, FAVICON_CAP).await {
                if !dl.bytes.is_empty() {
                    favicon_data_uri = Some(data_uri(&dl.bytes, dl.content_type.as_deref()));
                }
            }
        }
    }

    let site_name = meta
        .site_name
        .or_else(|| url.host_str().map(|h| h.to_string()));

    Ok(LinkPreview {
        url: url.to_string(),
        title: meta.title,
        description: meta.description,
        image_data_uri,
        favicon_data_uri,
        site_name,
        error: None,
    })
}

/// Search Openverse for openly-licensed images, download each (capped),
/// store them as local assets, and return local rel_paths + attribution.
#[tauri::command]
pub async fn fetch_images(
    app: tauri::AppHandle,
    query: String,
    count: u8,
    provider: String,
) -> Result<Vec<FetchedImage>, String> {
    if !provider.is_empty() && provider != "openverse" {
        return Err(format!(
            "unknown image provider '{provider}' (supported: openverse)"
        ));
    }
    let count = count.clamp(1, 8) as usize;
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("empty image search query".to_string());
    }

    let api_url = reqwest::Url::parse_with_params(
        "https://api.openverse.org/v1/images/",
        &[
            ("q", query.as_str()),
            ("license_type", "commercial,modification"),
            ("page_size", &count.to_string()),
        ],
    )
    .map_err(|e| e.to_string())?;

    let client = http_client()?;
    let body = download_capped(&client, api_url, PAGE_CAP).await?;
    let json: serde_json::Value =
        serde_json::from_slice(&body.bytes).map_err(|e| format!("bad Openverse response: {e}"))?;
    let results = json
        .get("results")
        .and_then(|r| r.as_array())
        .ok_or_else(|| "bad Openverse response: missing results".to_string())?;

    let mut fetched: Vec<FetchedImage> = Vec::new();
    for item in results.iter() {
        if fetched.len() >= count {
            break;
        }
        let Some(remote_url) = item.get("url").and_then(|v| v.as_str()) else {
            continue;
        };
        let Ok(img_url) = check_url(remote_url) else {
            continue;
        };
        let Ok(dl) = download_capped(&client, img_url, FETCHED_IMAGE_CAP).await else {
            continue; // one bad image must not sink the whole fetch
        };
        let ext_hint = remote_url.rsplit('.').next().unwrap_or("jpg");
        let app_handle = app.clone();
        let hint = ext_hint.to_string();
        let saved = tauri::async_runtime::spawn_blocking(move || {
            save_bytes_as_asset(&app_handle, &dl.bytes, &hint)
        })
        .await
        .map_err(|e| e.to_string())?;
        let Ok(saved) = saved else { continue };

        let attribution = item
            .get("attribution")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| {
                let creator = item
                    .get("creator")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("image");
                format!("\"{title}\" by {creator} (via Openverse)")
            });
        let license = {
            let l = item.get("license").and_then(|v| v.as_str()).unwrap_or("");
            let v = item
                .get("license_version")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            non_empty(format!("{} {}", l.to_ascii_uppercase(), v)).unwrap_or_default()
        };
        fetched.push(FetchedImage {
            id: saved.id,
            rel_path: saved.rel_path,
            url: remote_url.to_string(),
            thumb_url: item
                .get("thumbnail")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            attribution,
            license,
        });
    }
    Ok(fetched)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_guard_rejects_non_https_and_private_hosts() {
        assert!(check_url("http://example.com").is_err());
        assert!(check_url("ftp://example.com").is_err());
        assert!(check_url("not a url").is_err());
        assert!(check_url("https://localhost/x").is_err());
        assert!(check_url("https://foo.localhost/x").is_err());
        assert!(check_url("https://printer.local/x").is_err());
        assert!(check_url("https://127.0.0.1/x").is_err());
        assert!(check_url("https://10.0.0.8/x").is_err());
        assert!(check_url("https://172.16.4.1/x").is_err());
        assert!(check_url("https://192.168.1.10/x").is_err());
        assert!(check_url("https://169.254.169.254/meta").is_err());
        assert!(check_url("https://100.64.3.2/x").is_err());
        assert!(check_url("https://0.0.0.0/x").is_err());
        assert!(check_url("https://[::1]/x").is_err());
        assert!(check_url("https://[fe80::1]/x").is_err());
        assert!(check_url("https://[fd00::5]/x").is_err());
        assert!(check_url("https://[::ffff:192.168.0.1]/x").is_err());
        // single-label intranet hostnames are blocked too
        assert!(check_url("https://intranet/x").is_err());

        assert!(check_url("https://example.com/page").is_ok());
        assert!(check_url("https://api.openverse.org/v1/images/").is_ok());
        assert!(check_url("https://8.8.8.8/x").is_ok());
    }

    #[test]
    fn extension_sniffing_recognizes_magic_bytes() {
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
        assert_eq!(sniff_extension(&png), Some("png"));
        assert_eq!(sniff_extension(&[0xff, 0xd8, 0xff, 0xe0, 0x00]), Some("jpg"));
        assert_eq!(sniff_extension(b"GIF89a-------"), Some("gif"));
        let mut webp = b"RIFF\x00\x00\x00\x00WEBPVP8 ".to_vec();
        assert_eq!(sniff_extension(&webp), Some("webp"));
        webp[8] = b'X'; // corrupt the WEBP tag
        assert_eq!(sniff_extension(&webp), None);
        assert_eq!(sniff_extension(b"<svg xmlns=\"a\">"), Some("svg"));
        assert_eq!(sniff_extension(b"random bytes here"), None);

        // Fallback sanitization when sniffing fails.
        assert_eq!(sanitize_extension("JPEG"), "jpg");
        assert_eq!(sanitize_extension(".PnG"), "png");
        assert_eq!(sanitize_extension("../../evil"), "evil");
        assert_eq!(sanitize_extension(""), "bin");
        assert_eq!(sanitize_extension("verylongextension"), "veryl");
    }

    #[test]
    fn hashing_and_base64_are_stable() {
        assert_eq!(fnv1a64(b""), 0xcbf29ce484222325);
        assert_eq!(fnv1a64(b"a"), fnv1a64(b"a"));
        assert_ne!(fnv1a64(b"a"), fnv1a64(b"b"));

        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        let uri = data_uri(&[0xff, 0xd8, 0xff, 0x00], None);
        assert!(uri.starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn page_meta_extraction_prefers_og_tags() {
        let base = reqwest::Url::parse("https://example.com/article/1").unwrap();
        let html = r#"<html><head>
            <title>Fallback title</title>
            <meta property="og:title" content="OG Title" />
            <meta property="og:description" content="A description." />
            <meta property="og:site_name" content="Example" />
            <meta property="og:image" content="/img/cover.png" />
            <link rel="icon" href="/favicon.svg" />
        </head><body></body></html>"#;
        let meta = extract_page_meta(html, &base);
        assert_eq!(meta.title.as_deref(), Some("OG Title"));
        assert_eq!(meta.description.as_deref(), Some("A description."));
        assert_eq!(meta.site_name.as_deref(), Some("Example"));
        assert_eq!(
            meta.image_url.as_deref(),
            Some("https://example.com/img/cover.png")
        );
        assert_eq!(
            meta.favicon_url.as_deref(),
            Some("https://example.com/favicon.svg")
        );

        // Bare page: title falls back, favicon defaults to /favicon.ico.
        let bare = extract_page_meta("<html><head><title> Hi </title></head></html>", &base);
        assert_eq!(bare.title.as_deref(), Some("Hi"));
        assert_eq!(
            bare.favicon_url.as_deref(),
            Some("https://example.com/favicon.ico")
        );
        assert_eq!(bare.image_url, None);
    }
}
