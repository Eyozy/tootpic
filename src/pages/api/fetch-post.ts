import type { APIRoute } from 'astro';
import { FediverseClient } from '../../utils/fediverseClient';
import { normalizeAndDedupeAttachments } from '../../utils/netHelpers';

function extractBilibiliIds(text: string): Array<{ type: 'bvid' | 'aid'; id: string; sourceUrl?: string }> {
  const out: Array<{ type: 'bvid' | 'aid'; id: string; sourceUrl?: string }> = [];
  const seen = new Set<string>();
  const raw = String(text || '');

  // 1) Direct BV ids in text
  for (const m of raw.matchAll(/\bBV[0-9A-Za-z]{10}\b/g)) {
    const id = m[0];
    const key = `bvid:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: 'bvid', id });
  }

  // 2) URLs (bilibili.com / b23.tv)
  for (const m of raw.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) {
    const url = m[0];
    if (!/bilibili\.com|b23\.tv/i.test(url)) continue;

    const bv = url.match(/\/video\/(BV[0-9A-Za-z]{10})/i)?.[1];
    if (bv) {
      const key = `bvid:${bv}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ type: 'bvid', id: bv, sourceUrl: url });
      }
      continue;
    }

    const av = url.match(/\/video\/av(\d+)/i)?.[1] || url.match(/[?&]aid=(\d+)/i)?.[1];
    if (av) {
      const key = `aid:${av}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ type: 'aid', id: av, sourceUrl: url });
      }
      continue;
    }

    // b23.tv short links: keep as sourceUrl so we can resolve later
    if (/b23\.tv/i.test(url)) {
      const key = `b23:${url}`;
      if (!seen.has(key)) {
        seen.add(key);
        // placeholder; resolved later
        out.push({ type: 'bvid', id: '', sourceUrl: url });
      }
    }
  }

  return out;
}

async function resolveB23ToCanonical(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'TootPic/1.0 (+https://github.com/Eyozy/tootpic)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    // node fetch exposes final URL here
    return res.url || null;
  } catch {
    return null;
  }
}

async function fetchBilibiliView(params: { bvid?: string; aid?: string }): Promise<{ canonicalUrl: string; title?: string; thumbnailUrl?: string } | null> {
  const qs = params.bvid ? `bvid=${encodeURIComponent(params.bvid)}` : params.aid ? `aid=${encodeURIComponent(params.aid)}` : '';
  if (!qs) return null;

  const apiUrl = `https://api.bilibili.com/x/web-interface/view?${qs}`;
  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'TootPic/1.0 (+https://github.com/Eyozy/tootpic)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) return null;

  const json: any = await res.json().catch(() => null);
  if (!json || typeof json !== 'object' || json.code !== 0 || !json.data) return null;

  const bvid = String(json.data.bvid || params.bvid || '').trim();
  const aid = String(json.data.aid || params.aid || '').trim();
  const canonicalUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : '';
  if (!canonicalUrl) return null;

  const title = typeof json.data.title === 'string' ? json.data.title : undefined;
  const thumbnailUrl = typeof json.data.pic === 'string' ? json.data.pic : undefined;
  return { canonicalUrl, title, thumbnailUrl };
}

/**
 * Rate limiter using sliding window algorithm with automatic cleanup
 */
class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly limit: number;
  private readonly windowMs: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;

    // Cleanup expired data every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  check(clientIp: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(clientIp) || [];

    // Filter out requests outside the time window
    const validTimestamps = timestamps.filter(
      ts => now - ts < this.windowMs
    );

    if (validTimestamps.length >= this.limit) {
      return false;
    }

    validTimestamps.push(now);
    this.requests.set(clientIp, validTimestamps);

    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [ip, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter(ts => now - ts < this.windowMs);

      if (valid.length === 0) {
        this.requests.delete(ip);
        cleanedCount++;
      } else {
        this.requests.set(ip, valid);
      }
    }

    if (cleanedCount > 0) {
      console.log(`[RateLimiter] Cleaned ${cleanedCount} expired IPs, active: ${this.requests.size}`);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.requests.clear();
  }

  getStats(): { activeIPs: number; totalRecords: number } {
    let totalRecords = 0;
    for (const timestamps of this.requests.values()) {
      totalRecords += timestamps.length;
    }
    return {
      activeIPs: this.requests.size,
      totalRecords
    };
  }
}

const rateLimiter = new RateLimiter(50, 60 * 60 * 1000); // 50 requests per hour

function getClientIP(request: Request): string {
  // Priority: X-Forwarded-For > X-Real-IP > CF-Connecting-IP
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;

  return request.headers.get('cf-connecting-ip') || 'unknown';
}

// This must be set to false for POST requests to work correctly in production.
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  const allowedOrigins = [
    'https://tootpic.vercel.app',
    'http://localhost:4321'
  ];

  if (origin && allowedOrigins.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

  try {
    const clientIp = getClientIP(request);
    if (!rateLimiter.check(clientIp)) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          errorCode: 'RATE_LIMIT',
          retryAfter: 3600
        }),
        { status: 429, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { url } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'Please provide a URL' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }

    if (!body || typeof body !== 'object') {
      return new Response(
        JSON.stringify({ error: 'Invalid request body', errorCode: 'INVALID_BODY' }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Please provide a valid URL', errorCode: 'MISSING_URL' }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (url.length > 500) {
      return new Response(
        JSON.stringify({ error: 'URL too long', errorCode: 'URL_TOO_LONG' }),
        { status: 400, headers: corsHeaders }
      );
    }

    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return new Response(
          JSON.stringify({ error: 'URL must use HTTP or HTTPS', errorCode: 'INVALID_PROTOCOL' }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Block internal network addresses
      const hostname = urlObj.hostname.toLowerCase();
      const internalPatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^192\.168\./,
        /^172\.(1[6-9]|2[0-9]|3[01])\./,
        /^169\.254\./,
        /^0\./,
        /^::1$/,
        /^fc00:/,
        /^fe80:/
      ];

      if (internalPatterns.some(pattern => pattern.test(hostname))) {
        return new Response(
          JSON.stringify({ error: 'Internal network addresses not allowed', errorCode: 'INTERNAL_URL' }),
          { status: 400, headers: corsHeaders }
        );
      }

      if (/[<>'"&]/.test(url)) {
        return new Response(
          JSON.stringify({ error: 'URL contains invalid characters', errorCode: 'INVALID_CHARS' }),
          { status: 400, headers: corsHeaders }
        );
      }

    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format', errorCode: 'INVALID_URL_FORMAT' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Use the FediverseClient to fetch real data
    const result = await FediverseClient.fetchPost(url);

    if (!result.success) {
      return new Response(
        JSON.stringify({
          error: result.error,
          errorCode: result.errorCode,
          suggestion: result.suggestion,
          platform: result.platform,
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }

    // Normalize attachments early to prevent duplicated media in the preview (common on Ech0 API merges).
    if (result.data?.attachments?.length) {
      result.data.attachments = normalizeAndDedupeAttachments(result.data.attachments, url);
    }

    // For video attachments without a usable preview, mark them for client-side thumbnail generation.
    // Client-side will use Canvas to capture the first frame for better quality.
    const siteOrigin = new URL(request.url).origin;
    for (const att of result.data!.attachments || []) {
      if (att?.type !== 'video') continue;
      const url = typeof att.url === 'string' ? att.url : '';
      if (!url) continue;
      const preview = typeof att.previewUrl === 'string' ? att.previewUrl : '';
      const isEch0 = result.platform === 'ech0';
      const isDerivedThumb = preview.endsWith('_thumb.jpeg') || preview.endsWith('_thumb.jpg');
      if (!preview || /^data:/i.test(preview) || (isEch0 && isDerivedThumb)) {
        // Check if it's a direct video file (Ech0 self-hosted)
        const isDirectVideo = /\.(mp4|webm|mov)$/i.test(url);
        if (isDirectVideo) {
          // Mark for client-side thumbnail generation
          (att as any).__needsClientThumbnail = true;
          // Use a placeholder initially - client will generate real thumbnail
          att.previewUrl = `${siteOrigin}/api/video-thumbnail?url=${encodeURIComponent(url)}&t=0.8`;
        } else {
          // For external videos (YouTube, Bilibili), use server-generated placeholder
          att.previewUrl = `${siteOrigin}/api/video-thumbnail?url=${encodeURIComponent(url)}&t=0.8`;
        }
      }
    }

    // Bilibili cards: resolve title/thumbnail server-side and pass to client (plan A).
    const linkCards: any[] = [];
    const coverUrls: string[] = [];
    try {
      const extUrl = (result.data as any)?.extension?.url;
      const textForLinks = `${result.data!.content || ''}\n${typeof extUrl === 'string' ? extUrl : ''}`;
      const candidates = extractBilibiliIds(textForLinks).slice(0, 4); // avoid runaway

      for (const cand of candidates) {
        if (linkCards.length >= 2) break;

        // Resolve b23.tv short links if needed
        let bvid = cand.type === 'bvid' ? cand.id : '';
        let aid = cand.type === 'aid' ? cand.id : '';

        if (!bvid && !aid && cand.sourceUrl && /b23\.tv/i.test(cand.sourceUrl)) {
          const finalUrl = await resolveB23ToCanonical(cand.sourceUrl);
          if (finalUrl) {
            bvid = finalUrl.match(/\/video\/(BV[0-9A-Za-z]{10})/i)?.[1] || '';
            aid = finalUrl.match(/\/video\/av(\d+)/i)?.[1] || finalUrl.match(/[?&]aid=(\d+)/i)?.[1] || '';
          }
        }

        const view = await fetchBilibiliView(bvid ? { bvid } : aid ? { aid } : {});
        // Even if the view API fails, keep a fallback card (at least the URL) so it still renders.
        const canonicalUrl =
          view?.canonicalUrl ||
          (bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : '');
        if (!canonicalUrl) continue;

        const key = `bili:${canonicalUrl}`;
        if (linkCards.some(c => `bili:${c.url}` === key)) continue;

        linkCards.push({
          kind: 'bilibili',
          url: canonicalUrl,
          title: view?.title,
          thumbnailUrl: view?.thumbnailUrl,
        });

        if (view?.thumbnailUrl) coverUrls.push(view.thumbnailUrl);
      }
    } catch {
      // best-effort; ignore failures
    }

    if (linkCards.length > 0) {
      (result.data as any).linkCards = linkCards;
    }

    // Collect image URLs from the post data
    const imageUrls = [
      // Post attachments - handle different types
      ...result.data!.attachments.flatMap(att => {
        const urls = [];

        // For images, always add the URL
        if (att.type === 'image') {
          urls.push(att.url);
        }
        // For videos and GIFs, prefer preview URL if available
        else if (att.type === 'video' || att.type === 'gifv') {
          if (att.previewUrl) {
            urls.push(att.previewUrl);
          }
          // If no preview URL, don't add video URL to imageUrls
          // Videos can't be rendered as images
        }
        // For document type, check if it's actually a video
        else if (att.type === 'document') {
          const url = att.url?.toLowerCase() || '';
          if (url.match(/\.(mp4|webm|mov|avi|mkv|flv|wmv)$/)) {
            // This is a video file
            if (att.previewUrl) {
              urls.push(att.previewUrl);
            }
          } else {
            // Unknown document type, try to use URL if it looks like an image
            if (url.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
              urls.push(att.url);
            }
          }
        }
        // For other types, try to use them if they look like images
        else if (att.url) {
          const url = att.url.toLowerCase();
          if (url.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
            urls.push(att.url);
          }
        }

        return urls;
      }),
      // User avatar (if available)
      ...(result.data!.account.avatar ? [result.data!.account.avatar] : []),
      // User emojis
      ...result.data!.account.emojis.map(emoji => emoji.url)
      ,
      // Link card covers (e.g. bilibili)
      ...coverUrls
    ].filter(url => url && typeof url === 'string' && url.trim() !== '');

    const uniqueImageUrls = Array.from(new Set(imageUrls));

    const urlParts = new URL(url);
    const fetchedInstance = urlParts.hostname;

    // Fix acct field if it's empty
    if (result.data && result.data.account && !result.data.account.acct) {
      const username = result.data.account.username || result.data.account.displayName;
      const domain = new URL(result.data.account.url || '').hostname || fetchedInstance;
      result.data.account.acct = `${username}@${domain}`;
    }

    return new Response(
      JSON.stringify({
        postData: result.data,
        platform: result.platform,
        imageUrls: uniqueImageUrls,
        imageMap: {}, // Let the stream-images API handle image processing
        fetchedInstance: fetchedInstance,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );

  } catch (error) {
    console.error('API error occurred:', error);

    let errorMessage = 'Internal server error';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        details: String(error)
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  const allowedOrigins = [
    'https://tootpic.vercel.app',
    'http://localhost:4321'
  ];

  if (origin && allowedOrigins.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
};
