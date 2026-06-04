import { Injectable, Logger } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import * as net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import { QuillConfig } from '@/common/config/quill-config';
import { MessageService } from './message.service';
import type { LinkPreviewData } from './message.dto';

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024; // 512 KB of HTML — the <head> is always near the top
const MAX_REDIRECTS = 3;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 400;

// First bare http(s) URL in the message text. Excludes whitespace and a few
// delimiters that are never part of a URL; trailing punctuation is trimmed below.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;

/**
 * Server-side Open Graph link previews. Fetches user-supplied URLs, so it is
 * **SSRF-hardened**: only http/https, every resolved IP is validated at
 * connect time (defeating DNS rebinding), redirects are re-validated, and the
 * response is bounded by a timeout, a byte cap, and a `text/html` content-type
 * check. A failure (or a blocked target) simply yields no preview — it never
 * throws and never blocks the message send.
 */
@Injectable()
export class LinkPreviewService {
  private readonly logger = new Logger(LinkPreviewService.name);

  constructor(
    private readonly config: QuillConfig,
    private readonly messages: MessageService,
  ) {}

  /**
   * Fire-and-forget hydration: find the first URL in a just-sent message,
   * fetch a preview, and attach + broadcast it if one is found.
   */
  async hydrate(
    appId: string,
    roomId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    if (!this.config.linkPreviewsEnabled) return;
    try {
      const url = extractFirstUrl(content);
      if (!url) return;
      const preview = await fetchPreview(url);
      if (!preview) return;
      await this.messages.attachLinkPreviews(appId, roomId, messageId, [preview]);
    } catch (err) {
      this.logger.debug(`link preview failed: ${(err as Error)?.message ?? err}`);
    }
  }
}

// ── URL extraction ──────────────────────────────────────────────────────────

function extractFirstUrl(content: string): string | null {
  const m = URL_RE.exec(content);
  if (!m) return null;
  // Strip trailing sentence punctuation that the greedy match swept up.
  return m[0].replace(/[)\].,;:!?'"]+$/, '') || null;
}

// ── Fetch (SSRF-guarded) ────────────────────────────────────────────────────

async function fetchPreview(url: string): Promise<LinkPreviewData | null> {
  const page = await safeFetchHtml(url);
  if (!page) return null;
  const preview = parseOpenGraph(page.html, page.finalUrl, url);
  // A card with neither a title nor an image isn't worth showing.
  return preview.title || preview.imageUrl ? preview : null;
}

async function safeFetchHtml(
  rawUrl: string,
): Promise<{ html: string; finalUrl: string } | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchOnce(current);
    if (!res) return null;
    if (res.redirect) {
      try {
        current = new URL(res.redirect, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    return { html: res.html ?? '', finalUrl: current };
  }
  return null; // redirect budget exhausted
}

function fetchOnce(
  rawUrl: string,
): Promise<{ redirect?: string; html?: string } | null> {
  return new Promise((resolve) => {
    // Single-settle guard: destroying a stream on the size cap (or a timeout)
    // skips the 'end' event, so we must resolve explicitly at every exit and
    // make sure we only resolve once. Without this the promise can hang.
    let settled = false;
    const done = (value: { redirect?: string; html?: string } | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return done(null);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return done(null);

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        // Connect-time IP validation — the load-bearing SSRF guard. The socket
        // connects to exactly the IP we validated, so there is no DNS-rebinding
        // window. TLS still verifies the cert against the hostname (SNI).
        lookup: safeLookup,
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          'User-Agent': 'QuillLinkPreview/1.0 (+https://urbancare.ge)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en',
          // Discourage compressed bodies — we don't decompress, and identity
          // also sidesteps decompression-bomb concerns.
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          return done({ redirect: res.headers.location });
        }
        if (status !== 200) {
          res.destroy();
          return done(null);
        }
        if (!String(res.headers['content-type'] ?? '').includes('text/html')) {
          res.destroy();
          return done(null);
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total <= MAX_BYTES) {
            chunks.push(c);
          } else {
            // Enough for the <head>; stop and resolve with what we have. The
            // destroy() below won't emit 'end', so settle here.
            res.destroy();
            done({ html: Buffer.concat(chunks).toString('utf8') });
          }
        });
        res.on('end', () => done({ html: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', () => done(null));
        res.on('close', () => done(null)); // safety net if neither fired
      },
    );
    req.on('timeout', () => {
      req.destroy();
      done(null);
    });
    req.on('error', () => done(null));
    req.end();
  });
}

/**
 * Custom DNS lookup that rejects the connection if the host resolves to any
 * private / reserved / loopback / link-local address (incl. cloud metadata at
 * 169.254.169.254). Resolves all records, blocks if *any* is internal, and
 * pins the socket to a validated IP.
 */
function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { all: true }, (err, addresses: LookupAddress[]) => {
    if (err || !addresses?.length) {
      return callback(err ?? new Error('DNS resolution failed'), '', 4);
    }
    for (const a of addresses) {
      if (isBlockedIp(a.address)) {
        return callback(new Error(`blocked address: ${a.address}`), '', a.family);
      }
    }
    // Node's `autoSelectFamily` (Happy Eyeballs, on by default since Node 20)
    // calls a custom lookup with `all: true` and expects the validated array
    // back; the legacy path wants a single `(address, family)`. Returning the
    // wrong shape makes net try to connect to `undefined` ("Invalid IP address")
    // — so honour the flag.
    if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // not an IP literal post-resolution → refuse
}

function isBlockedV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && p[2] === 0) return true; // 192.0.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // multicast 224/4 + reserved/broadcast 240/4
  return false;
}

function isBlockedV6(ip: string): boolean {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isBlockedV4(mapped[1]);
  if (s === '::1' || s === '::') return true; // loopback / unspecified
  if (s.startsWith('fe80')) return true; // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique-local fc00::/7
  if (s.startsWith('ff')) return true; // multicast
  return false;
}

// ── Open Graph / meta parsing (dependency-free) ─────────────────────────────

function parseOpenGraph(html: string, finalUrl: string, originalUrl: string): LinkPreviewData {
  // Only scan up to </head> (or a bounded slice) — that's where OG tags live.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html.slice(0, MAX_BYTES);
  const meta = collectMeta(head);

  const title = clean(meta['og:title'] ?? meta['twitter:title'] ?? extractTitle(head), MAX_TITLE);
  const description = clean(
    meta['og:description'] ?? meta['twitter:description'] ?? meta['description'],
    MAX_DESCRIPTION,
  );
  const rawImage = meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'];
  const imageUrl = rawImage ? absolutize(rawImage, finalUrl) : undefined;
  const siteName = clean(meta['og:site_name'], 100) ?? hostOf(originalUrl);

  return {
    url: originalUrl,
    title,
    description,
    imageUrl,
    siteName,
  };
}

function collectMeta(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const key = (getAttr(tag, 'property') ?? getAttr(tag, 'name'))?.toLowerCase();
    const content = getAttr(tag, 'content');
    if (key && content != null && !(key in out)) out[key] = content;
  }
  return out;
}

function getAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1] : undefined;
}

function clean(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const decoded = decodeEntities(value).replace(/\s+/g, ' ').trim();
  if (!decoded) return undefined;
  return decoded.length > max ? `${decoded.slice(0, max - 1)}…` : decoded;
}

function absolutize(href: string, base: string): string | undefined {
  try {
    return new URL(decodeEntities(href.trim()), base).toString();
  } catch {
    return undefined;
  }
}

function hostOf(u: string): string | undefined {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&'); // last, so &amp;#39; doesn't double-decode
}

function fromCodePoint(cp: number): string {
  try {
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  } catch {
    return '';
  }
}
