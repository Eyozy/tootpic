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

export interface FediverseLinkCard {
  kind: 'bilibili';
  url: string; // canonical URL
  title?: string;
  thumbnailUrl?: string; // remote image URL (will be preloaded via stream-images)
}

export interface FediverseExtension {
  type: 'MUSIC' | 'VIDEO' | 'WEBSITE' | 'GITHUBPROJ';
  url: string;
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
  linkCards?: FediverseLinkCard[];
  extension?: FediverseExtension;
  quotedPost?: FediversePost;
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

// ponytail: re-exported for backward compatibility; import directly from constants/platforms once callers migrate
export { SUPPORTED_PLATFORMS } from '../constants/platforms';
