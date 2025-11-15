import type { APIRoute } from 'astro';
import { FediverseClient } from '../../utils/fediverseClient';

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
    'http://localhost:4321',
    'http://localhost:3000'
  ];

  if (origin && allowedOrigins.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  } else if (origin && origin.includes('localhost')) {
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
    ].filter(url => url && typeof url === 'string' && url.trim() !== '');

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
        imageUrls: imageUrls,
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
    'http://localhost:4321',
    'http://localhost:3000'
  ];

  if (origin && allowedOrigins.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  } else if (origin && origin.includes('localhost')) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
};