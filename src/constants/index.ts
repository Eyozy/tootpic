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
