import type { APIRoute } from 'astro';
import { buildCorsHeaders, parseEncodedUrlList, INTERNAL_HOST_PATTERNS } from '../../utils/netHelpers';

// This must be set to false for GET requests with query params to work correctly in production.
export const prerender = false;

// Image processing configuration
const IMAGE_LIMITS = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  TIMEOUT: 5000, // 5 seconds timeout
  MAX_URLS: 20, // Maximum 20 images at once
};

/**
 * Fetch image and convert to Base64
 * @param url Image URL
 * @param timeout Timeout in milliseconds
 * @returns Object containing original URL and converted Data URL, or failed marker
 */
async function imageToBase64(
  url: string,
  timeout = IMAGE_LIMITS.TIMEOUT,
  opts: { allowSameOrigin?: string } = {},
): Promise<{ url: string, dataUrl: string }> {
  
  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { url, dataUrl: 'failed' };
    }

    
    const hostname = urlObj.hostname.toLowerCase();
    const allowSameOrigin = typeof opts.allowSameOrigin === 'string' ? opts.allowSameOrigin : '';
    const isSameOrigin = !!allowSameOrigin && urlObj.origin === allowSameOrigin;
    if (!isSameOrigin && INTERNAL_HOST_PATTERNS.some(pattern => pattern.test(hostname))) {
      return { url, dataUrl: 'failed' };
    }

    // NOTE: '&' is valid in query strings (e.g. /api/video-thumbnail?url=...&t=...).
    // Only reject characters that can cause HTML/attribute injection.
    if (/[<>'"]/.test(url)) {
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
  const corsHeaders = buildCorsHeaders(request, 'GET, OPTIONS');

  try {
    const searchParams = new URL(request.url).searchParams;
    const imageUrlsParam = searchParams.get('urls');

    
    if (!imageUrlsParam || typeof imageUrlsParam !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing URLs parameter', errorCode: 'MISSING_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Increased limit to support complex posts with many images and emojis
    // Encoded URLs can be ~3x longer; 20000 chars supports ~30-40 image URLs
    if (imageUrlsParam.length > 20000) {
      console.error(`[stream-images] URLs parameter too long: ${imageUrlsParam.length} characters (max 20000)`);
      return new Response(
        JSON.stringify({ error: 'URLs parameter too long', errorCode: 'URLS_TOO_LONG' }),
        { status: 400, headers: corsHeaders }
      );
    }


    let rawUrls = parseEncodedUrlList(imageUrlsParam);
    const serverOrigin = new URL(request.url).origin;

    // Increased limit to support posts with many custom emojis
    // Typical case: 1 avatar + 4 images + 20+ emojis = 25+ URLs
    if (rawUrls.length > 30) {
      console.error(`[stream-images] Too many URLs: ${rawUrls.length} (max 30)`);
      return new Response(
        JSON.stringify({ error: 'Too many URLs (max 30)', errorCode: 'TOO_MANY_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    
    const imageUrls: string[] = [];
    for (const url of rawUrls) {
      try {
        const urlObj = new URL(url);

        
        if (!['http:', 'https:'].includes(urlObj.protocol)) continue;


        const hostname = urlObj.hostname.toLowerCase();
        const isSameOrigin = urlObj.origin === serverOrigin;
        if (!isSameOrigin && INTERNAL_HOST_PATTERNS.some(pattern => pattern.test(hostname))) continue;

        // NOTE: '&' is valid in URLs; do not block it.
        if (/[<>'"]/.test(url)) continue;

        imageUrls.push(url);
      } catch {
        
        continue;
      }
    }

    if (imageUrls.length === 0) {
      console.error(`[stream-images] No valid URLs after filtering. Raw URLs count: ${rawUrls.length}`);
      console.error(`[stream-images] First few raw URLs:`, rawUrls.slice(0, 3));
      return new Response(
        JSON.stringify({ error: 'No valid image URLs provided', errorCode: 'INVALID_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: object) => {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Batch processing: process 8 images at a time for better performance
        const BATCH_SIZE = 8;

        for (let i = 0; i < imageUrls.length; i += BATCH_SIZE) {
          const batch = imageUrls.slice(i, i + BATCH_SIZE);
          const promises = batch.map(url =>
            imageToBase64(url, IMAGE_LIMITS.TIMEOUT, { allowSameOrigin: serverOrigin }).then(result => {
              // Send each result back as soon as it's ready
              sendEvent(result);
            }).catch(() => {
              // Handle individual image errors without crashing the stream
              sendEvent({ url, dataUrl: 'failed' });
            })
          );

          // Wait for current batch to complete before starting next batch
          await Promise.allSettled(promises);
        }

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
  return new Response(null, {
    status: 200,
    headers: buildCorsHeaders(request, 'GET, OPTIONS')
  });
};
