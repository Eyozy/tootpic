import type { APIRoute } from 'astro';
import { buildCorsHeaders, parseEncodedUrlList, isSafeRemoteHttpUrl, safeFetch, fetchWithLimit } from '../../utils/netHelpers';

export const prerender = false;

const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'];
const FETCH_TIMEOUT_MS = 15000;

async function imageToBase64(
  url: string,
  opts: { allowSameOrigin?: string; signal?: AbortSignal } = {}
): Promise<{ url: string; dataUrl: string }> {
  try {
    const urlObj = new URL(url);
    const allowSameOrigin = opts.allowSameOrigin || '';
    const isSameOrigin = !!allowSameOrigin && urlObj.origin === allowSameOrigin;

    let response: Response;
    if (isSameOrigin) {
      response = await fetch(url, {
        signal: opts.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'Accept': ALLOWED_IMAGE_TYPES.join(', ') },
      });
    } else {
      if (!isSafeRemoteHttpUrl(url)) {
        return { url, dataUrl: 'failed' };
      }
      response = await safeFetch(url, {
        signal: opts.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': 'TootPic/1.0 (+https://github.com/Eyozy/tootpic)',
          'Accept': ALLOWED_IMAGE_TYPES.join(', '),
        },
      });
    }

    if (!response.ok) {
      return { url, dataUrl: 'failed' };
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase().split(';')[0] || 'image/png';
    const buffer = await fetchWithLimit(response, MAX_IMAGE_BYTES);
    const base64 = Buffer.from(buffer).toString('base64');

    return { url, dataUrl: `data:${contentType};base64,${base64}` };
  } catch {
    return { url, dataUrl: 'failed' };
  }
}

export const GET: APIRoute = async ({ request }) => {
  const corsHeaders = buildCorsHeaders(request, 'GET, OPTIONS');

  try {
    const searchParams = new URL(request.url).searchParams;
    const imageUrlsParam = searchParams.get('urls');

    if (!imageUrlsParam) {
      return new Response(
        JSON.stringify({ error: 'Missing URLs parameter', errorCode: 'MISSING_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (imageUrlsParam.length > 20000) {
      return new Response(
        JSON.stringify({ error: 'URLs parameter too long', errorCode: 'URLS_TOO_LONG' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const rawUrls = parseEncodedUrlList(imageUrlsParam);
    if (rawUrls.length > 30) {
      return new Response(
        JSON.stringify({ error: 'Too many URLs (max 30)', errorCode: 'TOO_MANY_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const serverOrigin = new URL(request.url).origin;
    const imageUrls = rawUrls.filter(url => {
      try {
        const urlObj = new URL(url);
        if (!['http:', 'https:'].includes(urlObj.protocol)) return false;
        if (/[<>'"]/.test(url)) return false;
        return urlObj.origin === serverOrigin || isSafeRemoteHttpUrl(url);
      } catch {
        return false;
      }
    });

    if (imageUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid image URLs provided', errorCode: 'INVALID_URLS' }),
        { status: 400, headers: corsHeaders }
      );
    }

    let isClosed = false;
    const abortController = new AbortController();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: object) => {
          if (isClosed) return;
          try {
            controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
          } catch {
            isClosed = true;
          }
        };

        const promises = imageUrls.map(url =>
          imageToBase64(url, {
            allowSameOrigin: serverOrigin,
            signal: abortController.signal,
          })
            .then(result => sendEvent(result))
            .catch(() => sendEvent({ url, dataUrl: 'failed' }))
        );

        await Promise.allSettled(promises);
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Stream might already be terminated by client
          }
        }
      },
      cancel() {
        isClosed = true;
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...corsHeaders,
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Error occurred while processing image stream',
        errorCode: 'STREAM_ERROR',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, {
    status: 200,
    headers: buildCorsHeaders(request, 'GET, OPTIONS'),
  });
};

