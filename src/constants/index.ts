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
  CORS_PROXY: 'https://cors.eu.org/',
  IMAGE_QUALITY: 1,
  IMAGE_PIXEL_RATIO: 3, // Set to 3x for ultra-high quality images
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
    QUALITY_SELECTOR: 'quality-selector',
} as const;
