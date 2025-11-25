/**
 * Application constants and configuration
 */

// Template names mapping
export const TEMPLATE_NAMES = {
  classic: 'Classic',
  magazine: 'Magazine',
  dark: 'Classic (Dark)',
  'magazine-dark': 'Magazine (Dark)',
} as const;

// Default template
export const DEFAULT_TEMPLATE_ID = 'classic';

// API configuration
export const API_CONFIG = {
  // CORS proxy is no longer needed as all requests are handled server-side
  IMAGE_QUALITY: 0.95, // Slightly lower quality for faster generation
  IMAGE_PIXEL_RATIO: 2, // Reduced from 3 to 2 for better performance (still high quality)
} as const;

// Image generation configuration
export const IMAGE_CONFIG = {
    MAX_WIDTH: 670,
    DEFAULT_BACKGROUND: '#ffffff',
    TEMPLATE_BACKGROUNDS: {
        classic: '#ffffff',
        magazine: '#faf8f5',
        dark: '#2d3748',
        'magazine-dark': '#2d3748',
    },
} as const;

// DOM element IDs
export const DOM_ELEMENT_IDS = {
    MASTODON_URL: 'mastodon-url',
    GENERATE_BTN: 'generate-btn',
    DOWNLOAD_BTN: 'download-btn',
    COPY_BTN: 'copy-btn',
    ERROR_MESSAGE: 'error-message',
    PREVIEW_AREA: 'preview-area',
    LOADER: 'loader',
    STYLE_A_CONTAINER: 'style-a-container',
    CLEAR_URL_BTN: 'clear-url-btn',
    USE_ORIGINAL_POST_DATA: 'use-original-post-data',
    INSTANCE_TOGGLE_CONTAINER: 'instance-toggle-container',
    TEMPLATE_TOGGLE: 'template-toggle',
    OPTIONS_TOGGLE: 'options-toggle',
    OPTIONS_CONTENT: 'options-content',
    OPTIONS_ICON: 'options-icon',
    PREVIEW_STATUS: 'preview-status',
    AVATAR_CONTAINER: 'style-a-avatar-container',
    DISPLAY_NAME: 'style-a-display-name',
    USERNAME: 'style-a-username',
    CONTENT: 'style-a-content',
    ATTACHMENT: 'style-a-attachment',
    BOTTOM_SECTION: 'bottom-section',
    TIMESTAMP: 'style-a-timestamp',
    STATS: 'style-a-stats',
    REPLIES: 'style-a-replies',
    BOOSTS: 'style-a-boosts',
    FAVS: 'style-a-favs',
    CURRENT_TEMPLATE_NAME: 'current-template-name',
    CONTENT_WARNING_BANNER: 'content-warning-banner',
    CONTENT_WARNING_TEXT: 'content-warning-text',
    CONTENT_WARNING_TOGGLE: 'content-warning-toggle',
    CONTENT_WARNING_TOGGLE_CONTAINER: 'content-warning-toggle-container',
} as const;
