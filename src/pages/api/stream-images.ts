import type { APIRoute } from 'astro';

// This must be set to false for GET requests with query params to work correctly in production.
export const prerender = false;

// Image processing configuration
const IMAGE_LIMITS = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  TIMEOUT: 10000, // 10 seconds timeout
  MAX_URLS: 20, // Maximum 20 images at once
};

/**
 * Fetch image and convert to Base64
 * @param url Image URL
 * @param timeout Timeout in milliseconds
 * @returns Object containing original URL and converted Data URL, or failed marker
 */
async function imageToBase64(url: string, timeout = IMAGE_LIMITS.TIMEOUT): Promise<{ url: string, dataUrl: string }> {
  // URL 安全验证
  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { url, dataUrl: 'failed' };
    }

    // 内部网络检测
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
      return { url, dataUrl: 'failed' };
    }

    // 危险字符检测
    if (/[<>'"&]/.test(url)) {
      return { url, dataUrl: 'failed' };
    }
  } catch {
    return { url, dataUrl: 'failed' };
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TootPic/1.0 (+https://github.com/Eyozy/tootpic)',
        'Accept': IMAGE_LIMITS.ALLOWED_TYPES.join(', '),
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { url, dataUrl: 'failed' };
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type')?.toLowerCase().split(';')[0] || 'image/png';
    const base64 = Buffer.from(buffer).toString('base64');

    return { url, dataUrl: `data:${contentType};base64,${base64}` };
  } catch (error) {
    return { url, dataUrl: 'failed' };
  }
}

/**
 * API route that streams image data back to the client using Server-Sent Events.
 */
export const GET: APIRoute = async ({ request }) => {
  // 修正版 CORS - 只允许的域名
  const origin = request.headers.get('origin');
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const imageUrlsParam = searchParams.get('urls');

    // 基础参数验证
    if (!imageUrlsParam || typeof imageUrlsParam !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing URLs parameter', errorCode: 'MISSING_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (imageUrlsParam.length > 5000) {
      return new Response(
        JSON.stringify({ error: 'URLs parameter too long', errorCode: 'URLS_TOO_LONG' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // 解码并验证 URL 参数
    const rawUrls = imageUrlsParam.split(',').map(url => decodeURIComponent(url.trim())).filter(Boolean);

    // 限制 URL 数量
    if (rawUrls.length > 10) { // 降低到 10 个
      return new Response(
        JSON.stringify({ error: 'Too many URLs (max 10)', errorCode: 'TOO_MANY_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // 验证每个 URL
    const imageUrls: string[] = [];
    for (const url of rawUrls) {
      try {
        const urlObj = new URL(url);

        // 协议验证
        if (!['http:', 'https:'].includes(urlObj.protocol)) continue;

        // 内部网络检测
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
        if (internalPatterns.some(pattern => pattern.test(hostname))) continue;

        // 危险字符检测
        if (/[<>'"&]/.test(url)) continue;

        imageUrls.push(url);
      } catch {
        // URL 格式错误，跳过
        continue;
      }
    }

    if (imageUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid image URLs provided', errorCode: 'INVALID_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Basic input validation
    if (imageUrls.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'No valid image URLs provided',
          suggestion: 'Please check if the urls parameter format is correct'
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

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: object) => {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Process all images in parallel with proper error handling
        const promises = imageUrls.map(url =>
          imageToBase64(url).then(result => {
            // Send each result back as soon as it's ready
            sendEvent(result);
          }).catch(() => {
            // Handle individual image errors without crashing the stream
            sendEvent({ url, dataUrl: 'failed' });
          })
        );

        // Wait for all promises to settle
        await Promise.allSettled(promises);

        // Close the stream once all images are processed
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
        ...corsHeaders
      },
    });

  } catch (error) {
    console.error('Stream processing error:', error);
    return new Response(
      JSON.stringify({
        error: 'Error occurred while processing image stream',
        suggestion: 'Please check if the input parameter format is correct'
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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