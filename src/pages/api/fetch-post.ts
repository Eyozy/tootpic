import type { APIRoute } from 'astro';
import { FediverseClient } from '../../utils/fediverseClient';

// 简单的请求限制（内存版）
const requestCounts = new Map<string, number>();
const RATE_LIMIT = 50; // 每小时 50 次
const WINDOW_MS = 60 * 60 * 1000; // 1 小时

function getClientIP(request: Request): string {
  // 获取客户端 IP，优先级：X-Forwarded-For > X-Real-IP > 其他
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;

  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function checkRateLimit(clientIp: string): boolean {
  const now = Date.now();
  const key = `${clientIp}:${Math.floor(now / WINDOW_MS)}`;
  const count = requestCounts.get(key) || 0;

  if (count >= RATE_LIMIT) return false;

  requestCounts.set(key, count + 1);
  return true;
}

// This must be set to false for POST requests to work correctly in production.
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // 修正版 CORS - 只允许的域名
  const origin = request.headers.get('origin');
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  // 验证来源域名
  const allowedOrigins = [
    'https://tootpic.vercel.app',
    'http://localhost:4321',
    'http://localhost:3000'
  ];

  if (origin && allowedOrigins.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  } else if (origin && origin.includes('localhost')) {
    // 开发环境特殊处理
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

  try {
    // 速率限制检查
    const clientIp = getClientIP(request);
    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', errorCode: 'RATE_LIMIT' }),
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

    // 基础输入验证
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

    // URL 格式和安全验证
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

      // 阻止内部网络地址
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

      // 危险字符检测
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

  // 处理 OPTIONS 预检请求
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