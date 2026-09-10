import type { PlatformConfig } from '../types/activitypub';

export const SUPPORTED_PLATFORMS: Record<string, PlatformConfig> = {
  mastodon: {
    name: 'Mastodon',
    urlPatterns: [
      /^https?:\/\/([^\/]+)\/@([^\/]+)\/(\d+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/users\/([^\/]+)\/statuses\/(\d+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/@([^\/]+)\/statuses\/([a-zA-Z0-9-]+)(?:\/.*)?$/, // Mastodon 4.x style
      /^https?:\/\/([^\/]+)\/users\/([^\/]+)\/statuses\/([a-zA-Z0-9-]+)(?:\/.*)?$/, // Mastodon 4.x users
    ],
    apiEndpoints: {
      status: {
        path: '/api/v1/statuses/{id}',
        method: 'GET'
      },
      actor: {
        path: '/api/v1/accounts/{id}',
        method: 'GET'
      },
    },
    supports: {
      sensitive: true,
      contentWarnings: true,
      customEmojis: true,
    },
  },
  pixelfed: {
    name: 'Pixelfed',
    urlPatterns: [
      // Standard post formats
      /^https?:\/\/([^\/]+)\/p\/([^\/]+)\/(\d+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/@([^\/]+)\/p\/(\d+)(?:\/.*)?$/,
      // Additional formats from various Pixelfed instances
      /^https?:\/\/([^\/]+)\/i\/web\/post\/(\d+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/users\/([^\/]+)\/statuses\/(\d+)(?:\/.*)?$/,
    ],
    apiEndpoints: {
      status: {
        path: '/api/v2/statuses/{id}',
        method: 'GET'
      },
      actor: {
        path: '/api/v1/accounts/{id}',
        method: 'GET'
      },
    },
    supports: {
      sensitive: true,
      contentWarnings: true,
      customEmojis: false,
    },
  },
  peertube: {
    name: 'PeerTube',
    urlPatterns: [
      // Full video watch URLs - PeerTube uses alphanumeric IDs
      /^https?:\/\/([^\/]+)\/videos\/watch\/([a-zA-Z0-9-]+)(?:\/.*)?$/,
      // Short link format /w/uuid
      /^https?:\/\/([^\/]+)\/w\/([a-zA-Z0-9-]+)(?:\/.*)?$/,
      // Playlist video format
      /^https?:\/\/([^\/]+)\/videos\/watch\/playlist\/[^\/]+\/video\/([a-zA-Z0-9-]+)(?:\/.*)?$/,
      // Alternative /video/watch format
      /^https?:\/\/([^\/]+)\/video\/watch\/([a-zA-Z0-9-]+)(?:\/.*)?$/,
    ],
    apiEndpoints: {
      status: {
        path: '/api/v1/videos/{id}',
        method: 'GET'
      },
      actor: {
        path: '/api/v1/accounts/{id}',
        method: 'GET'
      },
    },
    supports: {
      sensitive: true,
      contentWarnings: false,
      customEmojis: false,
    },
  },
  pleroma: {
    name: 'Pleroma',
    urlPatterns: [
      /^https?:\/\/([^\/]+)\/objects\/([a-f0-9-]+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/notice\/([a-zA-Z0-9]+)(?:\/.*)?$/,
    ],
    apiEndpoints: {
      status: {
        path: '/api/v1/statuses/{id}',
        method: 'GET'
      },
      actor: {
        path: '/api/v1/accounts/{id}',
        method: 'GET'
      },
    },
    supports: {
      sensitive: true,
      contentWarnings: true,
      customEmojis: true,
    },
  },
  misskey: {
    name: 'Misskey',
    urlPatterns: [
      /^https?:\/\/([^\/]+)\/notes\/([a-zA-Z0-9]+)(?:\/.*)?$/,
    ],
    apiEndpoints: {
      status: {
        path: '/api/notes/show',
        method: 'POST'
      },
      actor: {
        path: '/api/users/show',
        method: 'POST'
      },
    },
    supports: {
      sensitive: true,
      contentWarnings: true,
      customEmojis: true,
    },
  },
  ech0: {
    name: 'Ech0',
    urlPatterns: [
      // Ech0 specific patterns - try these first
      /^https?:\/\/([^\/]+)\/echo\/(\d+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/objects\/(\d+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/posts\/(\d+)(?:\/.*)?$/,
      // Standard ActivityPub patterns (for alphanumeric IDs)
      /^https?:\/\/([^\/]+)\/objects\/([a-zA-Z0-9_-]+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/posts\/([a-zA-Z0-9_-]+)(?:\/.*)?$/,
      /^https?:\/\/([^\/]+)\/notes\/([a-zA-Z0-9_-]+)(?:\/.*)?$/,
    ],
    apiEndpoints: {
      status: {
        path: '/api/objects/{id}',
        method: 'GET'
      },
      actor: {
        path: '/api/actors/{username}',
        method: 'GET'
      },
    },
    supports: {
      sensitive: true,
      contentWarnings: true,
      customEmojis: false,
    },
  },
  generic: {
    name: 'Generic ActivityPub',
    urlPatterns: [
      /^https?:\/\/([^\/]+)\/(@[^\/]+|users\/[^\/]+|objects\/[^\/]+|notice\/[^\/]+|notes\/[^\/]+|statuses\/[^\/]+|p\/[^\/]+\/\d+|videos\/watch\/[^\/]+|posts\/[^\/]+)(?:\/.*)?$/,
    ],
    apiEndpoints: {
      status: {
        path: '/.well-known/webfinger',
        method: 'GET'
      },
      actor: {
        path: '/.well-known/webfinger',
        method: 'GET'
      },
    },
    supports: {
      sensitive: true,
      contentWarnings: false,
      customEmojis: false,
    },
  },
};
