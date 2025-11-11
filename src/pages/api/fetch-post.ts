import type { APIRoute } from 'astro';
import { FediverseClient } from '../../utils/fediverseClient';

// This must be set to false for POST requests to work correctly in production.
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // Simple CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
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

    // Use URL directly without validation

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

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};