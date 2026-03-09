const TAG_RE = /#([^\s#]+)/g;
const INTERNAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
 /^0\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

function stripHtmlTags(text: string): string {
  return String(text || '').replace(/<[^>]*>/g, ' ');
}

export function extractHashtagNames(markdown: string): string[] {
  const source = stripHtmlTags(markdown);
  const tags = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(source)) !== null) {
    const tag = match[1];
    if (!tag) continue;
    tags.add(tag);
  }
  return Array.from(tags);
}

function normalizeUrlForDedupe(rawUrl: string): string {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from'];
    dropParams.forEach(p => u.searchParams.delete(p));
    const s = u.toString();
    return s.endsWith('/') ? s.slice(0, -1) : s;
  } catch {
    return raw;
  }
}

function toAbsoluteUrl(rawUrl: string, baseUrl: string): string {
  const raw = String(rawUrl || '').trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!baseUrl) return raw;
  try {
    const base = new URL(baseUrl);
    if (raw.startsWith('/')) return `${base.origin}${raw}`;
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

export function normalizeAndDedupeAttachments(attachments: any[], baseUrl: string): any[] {
  const out: any[] = [];
  const seen = new Set<string>();

  for (const att of attachments || []) {
    const type = String(att?.type || '').toLowerCase();
    let url = typeof att?.url === 'string' ? att.url : '';
    if (!type || !url) continue;
    if (/^data:/i.test(url)) continue;

    url = toAbsoluteUrl(url, baseUrl);
    const previewUrl = typeof att?.previewUrl === 'string' ? toAbsoluteUrl(att.previewUrl, baseUrl) : undefined;

    const key = `${type}:${normalizeUrlForDedupe(url)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ ...att, url, ...(previewUrl ? { previewUrl } : {}) });
      continue;
    }

    const idx = out.findIndex(a => `${String(a?.type || '').toLowerCase()}:${normalizeUrlForDedupe(String(a?.url || ''))}` === key);
    if (idx >= 0) {
      const existing = out[idx];
      const existingHasPreview = !!existing?.previewUrl;
      const incomingHasPreview = !!previewUrl;
      if (!existingHasPreview && incomingHasPreview) out[idx] = { ...att, url, previewUrl };
    }
  }

  return out;
}

export function bufferToBody(buffer: Buffer): ArrayBuffer {
  const slice = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (slice instanceof ArrayBuffer) return slice;
  return new Uint8Array(buffer).buffer;
}

export function isSafeRemoteHttpUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (INTERNAL_HOST_PATTERNS.some(p => p.test(host))) return false;
    if (/[<>'"]/.test(rawUrl)) return false;
    return true;
  } catch {
    return false;
  }
}

const PRODUCTION_ORIGINS = ['https://tootpic.vercel.app'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function parseOrigin(rawOrigin: string): URL | null {
  try {
    return new URL(rawOrigin);
  } catch {
    return null;
  }
}

export function isAllowedRequestOrigin(rawOrigin: string | null, requestUrl: string): boolean {
  if (!rawOrigin) return false;
  if (PRODUCTION_ORIGINS.includes(rawOrigin)) return true;

  const originUrl = parseOrigin(rawOrigin);
  if (!originUrl) return false;
  if (!LOCAL_HOSTS.has(originUrl.hostname)) return false;

  const requestHost = new URL(requestUrl);
  if (!LOCAL_HOSTS.has(requestHost.hostname)) return false;

  return originUrl.port === requestHost.port;
}

export function buildCorsHeaders(request: Request, methods: string): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  if (isAllowedRequestOrigin(origin, request.url)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

export function parseEncodedUrlList(imageUrlsParam: string): string[] {
  if (!imageUrlsParam) return [];

  // Typical: each URL is encoded, then joined by literal commas.
  if (imageUrlsParam.includes(',')) {
    return imageUrlsParam
      .split(',')
      .map(url => decodeURIComponent(url.trim()))
      .filter(Boolean);
  }

  // Fallback: whole list encoded once (commas become %2C).
  const decodedAll = decodeURIComponent(imageUrlsParam);
  if (decodedAll.includes(',')) {
    const parts = decodedAll.split(',').map(s => s.trim()).filter(Boolean);
    const allLookLikeUrls = parts.length > 1 && parts.every(p => /^https?:\/\//i.test(p));
    if (allLookLikeUrls) return parts;
  }

  return decodedAll ? [decodedAll] : [];
}
