/**
 * Fetchable-URL guard — pure TS mirror of the Rust SSRF guard in
 * `src-tauri/src/media.rs` (keep the two in sync). Used to pre-validate
 * URLs in the renderer before spending a Tauri round-trip; the Rust side
 * re-checks everything (including DNS resolution), so this is a fast-path
 * filter, not the security boundary.
 */

export interface UrlCheck {
  ok: boolean;
  /** Human-readable rejection reason when `ok` is false. */
  reason?: string;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b < 128) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && octets[2] === 0) || // IETF 192.0.0/24
    (a === 192 && b === 0 && octets[2] === 2) || // TEST-NET-1
    (a === 198 && b === 51 && octets[2] === 100) || // TEST-NET-2
    (a === 203 && b === 0 && octets[2] === 113) || // TEST-NET-3
    a === 255 // broadcast-ish
  );
}

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::' || h === '::1') return true;
  // link-local fe80::/10 and unique-local fc00::/7
  if (/^fe[89ab]/.test(h) || /^f[cd]/.test(h)) return true;
  // IPv4-mapped, dotted form ::ffff:a.b.c.d
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (mappedDotted) {
    const octets = parseIpv4(mappedDotted[1]);
    return octets !== null && isPrivateIpv4(octets);
  }
  // IPv4-mapped, hex form ::ffff:c0a8:1 (URL parsers normalize to this)
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  return false;
}

/** Hostname-level block: localhost-ish names and private/reserved IPs. */
export function isBlockedHost(rawHost: string): boolean {
  let host = rawHost.trim().replace(/\.$/, '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.length === 0) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    return true;
  }
  const v4 = parseIpv4(host);
  if (v4) return isPrivateIpv4(v4);
  if (host.includes(':')) return isPrivateIpv6(host);
  // Single-label hostnames (intranet names) have no public DNS meaning.
  if (!host.includes('.')) return true;
  return false;
}

/** Validate a URL for outbound fetching: parseable, https-only, public host. */
export function checkFetchableUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'only https URLs can be fetched' };
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, reason: 'URL points at a local or private address' };
  }
  return { ok: true };
}

/**
 * Is `text` a single bare web URL (the paste-upgrade trigger)? Accepts
 * http/https; whether it is *fetchable* for a preview is a separate
 * `checkFetchableUrl` question.
 */
export function isBareUrl(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || /\s/.test(t)) return false;
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const url = new URL(t);
    return url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Display hostname for a URL ("www." stripped); '' when unparseable. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
