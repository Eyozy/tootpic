// ActivityPub compatible types that can represent content from any Fediverse platform
export interface ActivityPubActor {
  '@context': string[];
  id: string;
  type: 'Person' | 'Service' | 'Group' | 'Organization' | 'Application';
  name?: string;
  preferredUsername: string;
  summary?: string;
  icon?: ActivityPubImage;
  image?: ActivityPubImage;
  url?: string;
  inbox: string;
  outbox: string;
}

export interface ActivityPubImage {
  type: 'Image';
  mediaType: string;
  url: string;
  name?: string;
}

export interface ActivityPubObject {
  '@context': string[];
  id: string;
  type: string;
  attributedTo: ActivityPubActor | string;
  name?: string;
  content?: string;
  summary?: string;
  published: string;
  updated?: string;
  sensitive?: boolean;
  url?: string;
  inReplyTo?: string;
  to?: string[];
  cc?: string[];
  bto?: string[];
  bcc?: string[];
  attachment?: ActivityPubAttachment[];
  tag?: ActivityPubTag[];
  likes?: string;
  shares?: string;
  replies?: {
    type: string;
    first?: {
      type: string;
      items?: ActivityPubObject[];
    };
    totalItems?: number;
  };
}

export interface ActivityPubAttachment {
  type: 'Image' | 'Video' | 'Audio' | 'Document';
  mediaType: string;
  url: string;
  name?: string;
  width?: number;
  height?: number;
  blurhash?: string;
}

export interface ActivityPubTag {
  type: 'Hashtag' | 'Mention';
  href: string;
  name: string;
}

// Universal types for our application that can work with any ActivityPub platform
export interface FediversePollOption {
  title: string;
  votes_count: number;
  url?: string;
}

export interface FediversePoll {
  id: string;
  options: FediversePollOption[];
  expired: boolean;
  expires_at?: string;
  multiple: boolean;
  votes_count: number;
  voters_count?: number;
  voted?: boolean;
  own_votes?: number[];
}

export interface FediversePost {
  id: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  account: FediverseAccount;
  attachments: FediverseAttachment[];
  repliesCount: number;
  boostsCount: number;
  favouritesCount: number;
  sensitive: boolean;
  spoilerText: string;
  url: string;
  platform: string;
  inReplyTo?: string;
  language?: string;
  tags: FediverseTag[];
  poll?: FediversePoll;
}

export interface FediverseAccount {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  url: string;
  acct: string; // username@domain format
  platform: string;
  emojis: FediverseEmoji[];
}

export interface FediverseAttachment {
  type: 'image' | 'video' | 'audio' | 'gifv' | 'document';
  url: string;
  previewUrl?: string;
  description?: string;
  width?: number;
  height?: number;
  blurhash?: string;
}

export interface FediverseEmoji {
  shortcode: string;
  url: string;
  staticUrl?: string;
}

export interface FediverseTag {
  name: string;
  url: string;
  type: 'hashtag' | 'mention';
}

// Platform detection and URL patterns
export interface PlatformConfig {
  name: string;
  urlPatterns: RegExp[];
  apiEndpoints: {
    status: {
      path: string;
      method: 'GET' | 'POST';
    };
    actor: {
      path: string;
      method: 'GET' | 'POST';
    };
  };
  supports: {
    sensitive?: boolean;
    contentWarnings?: boolean;
    customEmojis?: boolean;
  };
}

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