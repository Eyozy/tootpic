import type { APIRoute } from 'astro';
import { safeFetch } from '../../utils/netHelpers';

export const prerender = false;

const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'last-modified',
];

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const rawUrl = url.searchParams.get('url') || '';
  const isProbe = url.searchParams.get('probe') === '1';

  try {
    const upstream = await safeFetch(rawUrl, {
      method: isProbe ? 'HEAD' : 'GET',
      headers: { 'Accept': 'image/*' },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      return new Response(isProbe ? null : 'Failed to fetch image', {
        status: isProbe ? 204 : (upstream.status || 502),
        headers: isProbe ? { 'X-Image-Available': '0', 'Cache-Control': 'no-store' } : undefined,
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return new Response(isProbe ? null : 'Upstream is not an image', {
        status: isProbe ? 204 : 415,
        headers: isProbe ? { 'X-Image-Available': '0', 'Cache-Control': 'no-store' } : undefined,
      });
    }

    if (isProbe) {
      return new Response(null, {
        status: 204,
        headers: {
          'X-Image-Available': '1',
          'Cache-Control': 'no-store',
        },
      });
    }

    const responseHeaders = new Headers();
    for (const name of PASSTHROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set('Cache-Control', upstream.headers.get('cache-control') || 'public, max-age=3600');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(isProbe ? null : 'Invalid or unreachable image URL', {
      status: isProbe ? 204 : 400,
      headers: isProbe ? { 'X-Image-Available': '0', 'Cache-Control': 'no-store' } : undefined,
    });
  }
};

