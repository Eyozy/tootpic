import { PlatformConfig, SUPPORTED_PLATFORMS } from '../types/activitypub';

export interface ParsedUrl {
  platform: string;
  domain: string;
  id: string;
  originalUrl: string;
  username?: string;
}

export interface FetchResult {
  success: boolean;
  data?: any;
  error?: string;
  platform?: string;
}

/**
 * Parse a Fediverse URL to extract platform, domain, and post ID
 */
export function parseFediverseUrl(url: string): ParsedUrl | null {
  try {
    const normalizedUrl = url.trim();

    // Try to match against known platform patterns
    for (const [platformKey, platform] of Object.entries(SUPPORTED_PLATFORMS)) {
      for (const pattern of platform.urlPatterns) {
        const match = normalizedUrl.match(pattern);
        if (match) {
          const domain = match[1];
          const id = match[match.length - 1]; // Last group is usually the ID
          const username = match.length > 3 ? match[2] : undefined;

          return {
            platform: platformKey,
            domain,
            id,
            originalUrl: normalizedUrl,
            username,
          };
        }
      }
    }

    // If no specific platform matched, try generic ActivityPub detection
    const genericPattern = /^https?:\/\/([^\/]+)\/(@[^\/]+|users\/[^\/]+|objects\/[^\/]+|notice\/[^\/]+|notes\/[^\/]+|statuses\/[^\/]+|p\/[^\/]+\/\d+|videos\/watch\/[^\/]+|w\/[^\/]+|i\/web\/post\/\d+)(?:\/.*)?$/;
    const genericMatch = normalizedUrl.match(genericPattern);

    if (genericMatch) {
      const domain = genericMatch[1];
      const path = genericMatch[2];

      // Try to extract ID from different URL patterns
      let id = '';
      if (path.includes('/@') || path.includes('/users/')) {
        // Mastodon-style: @username/12345
        const pathMatch = normalizedUrl.match(/\/(\d+)(?:\/.*)?$/);
        id = pathMatch ? pathMatch[1] : path;
      } else if (path.includes('/objects/') || path.includes('/notice/') || path.includes('/notes/')) {
        // Pleroma/Misskey-style: /objects/abc123
        const pathMatch = normalizedUrl.match(/\/(objects|notice|notes)\/([^\/\?]+)(?:\/.*)?$/);
        id = pathMatch ? pathMatch[2] : path;
      } else if (path.includes('/p/')) {
        // Pixelfed-style: /p/username/12345
        const pathMatch = normalizedUrl.match(/\/p\/[^\/]+\/(\d+)(?:\/.*)?$/);
        id = pathMatch ? pathMatch[1] : path;
      } else if (path.includes('/videos/watch/')) {
        // PeerTube-style: /videos/watch/abc123
        const pathMatch = normalizedUrl.match(/\/videos\/watch\/([^\/\?]+)(?:\/.*)?$/);
        id = pathMatch ? pathMatch[1] : path;
      } else {
        id = path;
      }

      return {
        platform: 'generic',
        domain,
        id,
        originalUrl: normalizedUrl,
      };
    }

    return null;
  } catch (error) {
    console.error('Error parsing Fediverse URL:', error);
    return null;
  }
}

/**
 * Detect if a URL is from a supported Fediverse platform
 */
export function isSupportedFediverseUrl(url: string): boolean {
  return parseFediverseUrl(url) !== null;
}

/**
 * Get platform configuration for a given URL
 */
export function getPlatformConfig(url: string): PlatformConfig | null {
  const parsed = parseFediverseUrl(url);
  return parsed ? SUPPORTED_PLATFORMS[parsed.platform] : null;
}

/**
 * Normalize different post IDs to a consistent format
 */
export function normalizePostId(platform: string, id: string): string {
  switch (platform) {
    case 'mastodon':
    case 'pleroma':
    case 'pixelfed':
      // These platforms typically use numeric IDs
      return id;
    case 'misskey':
      // Misskey uses alphanumeric IDs
      return id;
    case 'peertube':
      // PeerTube uses UUID for videos
      return id;
    case 'generic':
      // For generic, try to detect ID format
      if (/^\d+$/.test(id)) {
        return id; // Numeric ID
      } else if (/^[a-f0-9-]{36}$/i.test(id)) {
        return id; // UUID
      } else {
        return id; // Keep as-is
      }
    default:
      return id;
  }
}

/**
 * Extract username from URL if available
 */
export function extractUsername(url: string): string | null {
  const parsed = parseFediverseUrl(url);
  return parsed?.username || null;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

/**
 * Convert Mastodon format to our universal Fediverse format
 */
export function convertMastodonToUniversal(mastodonData: any): any {
  // Collect emojis from both account and post content
  const accountEmojis = mastodonData.account.emojis?.map((emoji: any) => ({
    shortcode: emoji.shortcode,
    url: emoji.url,
    staticUrl: emoji.static_url,
  })) || [];

  const contentEmojis = mastodonData.emojis?.map((emoji: any) => ({
    shortcode: emoji.shortcode,
    url: emoji.url,
    staticUrl: emoji.static_url,
  })) || [];

  // Merge emojis, removing duplicates based on shortcode
  const allEmojis = [...accountEmojis];
  contentEmojis.forEach((emoji: any) => {
    if (!allEmojis.find((e: any) => e.shortcode === emoji.shortcode)) {
      allEmojis.push(emoji);
    }
  });

  // Log avatar for debugging
  
  

  return {
    id: mastodonData.id,
    content: mastodonData.content,
    createdAt: mastodonData.created_at,
    updatedAt: mastodonData.edited_at,
    account: {
      id: mastodonData.account.id,
      username: mastodonData.account.username,
      displayName: mastodonData.account.display_name,
      avatar: mastodonData.account.avatar,
      url: mastodonData.account.url,
      acct: mastodonData.account.acct,
      platform: 'mastodon',
      emojis: allEmojis,
    },
    attachments: mastodonData.media_attachments?.map((attachment: any) => {
      // Normalize attachment type - Pixelfed may return 'document' for videos
      let normalizedType = attachment.type;

      // If type is 'document' but URL ends with video extensions, treat as video
      if (attachment.type === 'document' || attachment.type === 'unknown') {
        const url = attachment.url?.toLowerCase() || '';
        if (url.match(/\.(mp4|webm|mov|avi|mkv|flv|wmv)$/)) {
          normalizedType = 'video';
        }
      }

      // Get preview URL
      let previewUrl = attachment.preview_url || attachment.preview_image_url;

      // If no preview URL and this is a video, try to derive one
      if (!previewUrl && (normalizedType === 'video' || attachment.type === 'document')) {
        const videoUrl = attachment.url;
        if (videoUrl && typeof videoUrl === 'string') {
          // Try common thumbnail URL patterns
          // Pixelfed uses: video.mp4 -> video_thumb.jpeg
          const derivedUrls = [
            videoUrl.replace(/\.mp4$/i, '_thumb.jpeg'),  // Pixelfed pattern
            videoUrl.replace(/\.mp4$/i, '_thumb.jpg'),
            videoUrl.replace(/\.mp4$/i, '.jpg'),
            videoUrl.replace(/\.mp4$/i, '.png'),
            videoUrl.replace(/\.mp4$/i, '-thumb.jpg'),
          ];

          // Use the first derived URL
          previewUrl = derivedUrls[0];
          
        }
      }

      

      return {
        type: normalizedType,
        url: attachment.url,
        previewUrl: previewUrl,
        description: attachment.description,
        width: attachment.meta?.original?.width,
        height: attachment.meta?.original?.height,
        blurhash: attachment.blurhash,
      };
    }) || [],
    repliesCount: mastodonData.replies_count,
    boostsCount: mastodonData.reblogs_count,
    favouritesCount: mastodonData.favourites_count,
    sensitive: mastodonData.sensitive,
    spoilerText: mastodonData.spoiler_text,
    url: mastodonData.url,
    platform: 'mastodon',
    inReplyTo: mastodonData.in_reply_to_id,
    language: mastodonData.language,
    tags: mastodonData.tags?.map((tag: any) => ({
      name: tag.name,
      url: tag.url,
      type: 'hashtag' as const,
    })) || [],
  };
}

/**
 * Fetch user object from ActivityPub actor URL
 */
async function fetchUserObject(actorUrl: string): Promise<any> {
  try {
    const response = await fetch(actorUrl, {
      headers: {
        'Accept': 'application/activity+json, application/ld+json, application/json'
      }
    });

    if (!response.ok) {
      return null;
    }

    const userObject = await response.json();

    return userObject;
  } catch (error) {
    return null;
  }
}

/**
 * Convert ActivityPub format to our universal Fediverse format
 */
export async function convertActivityPubToUniversal(activityPubData: any, platform: string): Promise<any> {
  try {
    // Extract basic information
    const id = activityPubData.id;
    const content = activityPubData.content || activityPubData.summary || '';
    const createdAt = activityPubData.published || new Date().toISOString();
    const updatedAt = activityPubData.updated;

    // Handle account/actor information
    let account;
    if (activityPubData.attributedTo) {
      if (typeof activityPubData.attributedTo === 'string') {
        // Fetch user object to get complete information including avatar
        const userObject = await fetchUserObject(activityPubData.attributedTo);

        if (userObject) {
          // Extract emojis from user's tag array
          const userEmojis = userObject.tag?.filter((tag: any) => tag.type === 'Emoji').map((emoji: any) => ({
            shortcode: emoji.name?.replace(/:/g, '') || emoji.shortcode,
            url: emoji.icon?.url || emoji.url,
            staticUrl: emoji.icon?.url || emoji.url,
          })) || [];

          // Try multiple fields for avatar from fetched user object
          const avatarUrl = userObject.icon?.url ||
                           userObject.icon?.href ||
                           userObject.image?.url ||
                           userObject.image?.href;

          

          const domain = new URL(activityPubData.attributedTo).hostname;
          account = {
            id: userObject.id,
            username: userObject.preferredUsername || activityPubData.attributedTo.split('/').pop(),
            displayName: userObject.name || userObject.preferredUsername || activityPubData.attributedTo.split('/').pop(),
            avatar: avatarUrl,
            url: userObject.url || userObject.id,
            acct: userObject.preferredUsername ? `${userObject.preferredUsername}@${domain}` : `${userObject.preferredUsername || activityPubData.attributedTo.split('/').pop()}@${domain}`,
            platform,
            emojis: userEmojis,
          };
        } else {
          // Fallback if user object fetch fails
          const username = activityPubData.attributedTo.split('/').pop();
          const domain = new URL(activityPubData.attributedTo).hostname;
          account = {
            id: activityPubData.attributedTo,
            username: username,
            displayName: username,
            avatar: undefined, // No avatar available
            url: activityPubData.attributedTo,
            acct: `${username}@${domain}`,
            platform,
            emojis: [],
          };
        }
      } else {
        // Extract emojis from actor's tag array
        const actorEmojis = activityPubData.attributedTo.tag?.filter((tag: any) => tag.type === 'Emoji').map((emoji: any) => ({
          shortcode: emoji.name?.replace(/:/g, '') || emoji.shortcode,
          url: emoji.icon?.url || emoji.url,
          staticUrl: emoji.icon?.url || emoji.url,
        })) || [];

        // Try multiple fields for avatar
        const avatarUrl = activityPubData.attributedTo.icon?.url ||
                         activityPubData.attributedTo.icon?.href ||
                         activityPubData.attributedTo.image?.url ||
                         activityPubData.attributedTo.image?.href;

        // Get domain from attributedTo ID
        const actorDomain = new URL(activityPubData.attributedTo.id || '').hostname || 'unknown';

        account = {
          id: activityPubData.attributedTo.id,
          username: activityPubData.attributedTo.preferredUsername,
          displayName: activityPubData.attributedTo.name || activityPubData.attributedTo.preferredUsername,
          avatar: avatarUrl,
          url: activityPubData.attributedTo.url || activityPubData.attributedTo.id,
          acct: activityPubData.attributedTo.preferredUsername ? `${activityPubData.attributedTo.preferredUsername}@${actorDomain}` : `${activityPubData.attributedTo.preferredUsername || activityPubData.attributedTo.id?.split('/').pop() || 'unknown'}@${actorDomain}`,
          platform,
          emojis: actorEmojis,
        };
      }
    } else {
      // Fallback account info
      account = {
        id: 'unknown',
        username: 'unknown',
        displayName: 'Unknown User',
        url: '',
        acct: '',
        platform,
        emojis: [],
      };
    }

    // Extract emojis from post content's tag array
    const contentEmojis = activityPubData.tag?.filter((tag: any) => tag.type === 'Emoji').map((emoji: any) => ({
      shortcode: emoji.name?.replace(/:/g, '') || emoji.shortcode,
      url: emoji.icon?.url || emoji.url,
      staticUrl: emoji.icon?.url || emoji.url,
    })) || [];

    // Merge account and content emojis, removing duplicates
    const allEmojis = [...account.emojis];
    contentEmojis.forEach((emoji: any) => {
      if (!allEmojis.find((e: any) => e.shortcode === emoji.shortcode)) {
        allEmojis.push(emoji);
      }
    });
    account.emojis = allEmojis;

    // Log avatar for debugging
    
    

    // Handle attachments
    // Removed detailed debug output

    const attachments = activityPubData.attachment?.map((att: any) => {
      let attachmentType = att.type.toLowerCase();
      let attachmentUrl = att.url;
      let previewUrl = undefined;

      // Handle different URL formats
      if (typeof attachmentUrl === 'object' && attachmentUrl !== null) {
        // URL can be an array or object with href
        if (Array.isArray(attachmentUrl)) {
          // Find the main media URL and preview URL
          const videoUrl = attachmentUrl.find((u: any) => u.mediaType?.startsWith('video/'))?.href;
          const imageUrl = attachmentUrl.find((u: any) => u.mediaType?.startsWith('image/'))?.href;

          attachmentUrl = videoUrl || imageUrl || attachmentUrl[0]?.href || attachmentUrl[0];
          previewUrl = imageUrl; // Use image as preview if available
        } else if (attachmentUrl.href) {
          attachmentUrl = attachmentUrl.href;
        }
      }

      // Normalize attachment type - detect video by URL extension or mediaType
      if (attachmentType === 'document' || attachmentType === 'unknown') {
        const urlString = (typeof attachmentUrl === 'string' ? attachmentUrl : '').toLowerCase();
        if (urlString.match(/\.(mp4|webm|mov|avi|mkv|flv|wmv)$/)) {
          attachmentType = 'video';
        }
      }

      // For videos, try to find preview/thumbnail
      if (attachmentType === 'video') {
        // Try various preview fields
        previewUrl = previewUrl || att.preview?.url || att.thumbnail?.url || att.image?.url;

        // If url is an array, look for image type
        if (Array.isArray(att.url)) {
          const preview = att.url.find((u: any) => u.mediaType?.startsWith('image/'));
          if (preview) {
            previewUrl = preview.href || preview.url || preview;
          }
        }

        // If still no preview, try to extract from post's image field
        if (!previewUrl && activityPubData.image) {
          if (typeof activityPubData.image === 'string') {
            previewUrl = activityPubData.image;
          } else if (activityPubData.image.url) {
            previewUrl = activityPubData.image.url;
          }
        }

        // If still no preview, derive from video URL
        if (!previewUrl && attachmentUrl && typeof attachmentUrl === 'string') {
          // Pixelfed pattern: video.mp4 -> video_thumb.jpeg
          previewUrl = attachmentUrl.replace(/\.mp4$/i, '_thumb.jpeg');
          
        }
      }

      

      return {
        type: attachmentType,
        url: attachmentUrl,
        previewUrl: previewUrl,
        description: att.name,
        width: att.width,
        height: att.height,
      };
    }) || [];

    // Handle replies
    let repliesCount = 0;
    if (activityPubData.replies && typeof activityPubData.replies === 'object') {
      repliesCount = activityPubData.replies.totalItems || 0;
    }

    // Handle tags
    const tags = activityPubData.tag?.filter((tag: any) => tag.type === 'Hashtag' || tag.type === 'Mention').map((tag: any) => ({
      name: tag.name ? (tag.name.startsWith('#') ? tag.name : `#${tag.name}`) : '',
      url: tag.href || tag.url || '',
      type: tag.type === 'Mention' ? 'mention' as const : 'hashtag' as const,
    })).filter((tag: any) => tag.name && tag.url) || [];

    

    return {
      id,
      content,
      createdAt,
      updatedAt,
      account,
      attachments,
      repliesCount,
      boostsCount: 0, // ActivityPub doesn't standardize boost counts
      favouritesCount: 0, // ActivityPub doesn't standardize like counts
      sensitive: activityPubData.sensitive || false,
      spoilerText: activityPubData.summary || '',
      url: activityPubData.url || id,
      platform,
      inReplyTo: activityPubData.inReplyTo,
      tags,
    };
  } catch (error) {
    console.error('Error converting ActivityPub to universal format:', error);
    throw new Error('Failed to convert ActivityPub data to universal format');
  }
}