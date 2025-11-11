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
  // Simple CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const searchParams = new URL(request.url).searchParams;
    const imageUrlsParam = searchParams.get('urls');

    if (!imageUrlsParam) {
      return new Response(JSON.stringify({ error: 'Missing image URL parameter' }), { status: 400, headers: corsHeaders });
    }

    // Decode and validate URL parameters
    const imageUrls = imageUrlsParam
      .split(',')
      .map(url => decodeURIComponent(url.trim()))
      .filter(Boolean);

    // Limit the number of images to process
    if (imageUrls.length > IMAGE_LIMITS.MAX_URLS) {
      return new Response(
        JSON.stringify({
          error: `Too many images, maximum ${IMAGE_LIMITS.MAX_URLS} images can be processed at once`,
          suggestion: 'Please reduce the number of images to process'
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

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};