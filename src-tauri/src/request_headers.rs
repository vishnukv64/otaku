use std::net::IpAddr;
use url::Url;

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
const ALLMANGA_REFERER: &str = "https://allmanga.to";
const MANGAKAKALOT_REFERER: &str = "https://www.mangakakalot.fan/";

fn is_private_or_local_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") {
        return true;
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => {
                v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_multicast() || v4.is_unspecified()
            }
            IpAddr::V6(v6) => {
                v6.is_loopback() || v6.is_multicast() || v6.is_unspecified() || v6.is_unique_local()
            }
        };
    }

    false
}

fn is_mangakakalot_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();

    host.contains("mangakakalot")
        || host.contains("mangakakalove")
        || host.contains("manganato")
        || host.contains("natomanga")
        || host.contains("nelomanga")
        || host.contains("mangabats")
        || host.contains("mkklcdnv6")
        || host.ends_with(".2xstorage.com")
}

pub fn validate_public_http_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;

    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Unsupported URL scheme: {}", other)),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL is missing a host".to_string())?;

    if is_private_or_local_host(host) {
        return Err(format!("Refusing to proxy private or local host: {}", host));
    }

    Ok(parsed)
}

pub fn apply_image_source_headers(request: ureq::Request, parsed: &Url) -> ureq::Request {
    let host = parsed.host_str().unwrap_or_default();

    let request = request.set("User-Agent", DEFAULT_USER_AGENT);

    if is_mangakakalot_host(host) {
        request.set("Referer", MANGAKAKALOT_REFERER)
    } else {
        request.set("Referer", ALLMANGA_REFERER)
    }
}

pub fn build_image_request(url: &str) -> Result<ureq::Request, String> {
    let parsed = validate_public_http_url(url)?;
    Ok(apply_image_source_headers(ureq::get(url), &parsed))
}
