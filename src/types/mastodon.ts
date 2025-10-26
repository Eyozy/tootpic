export interface MastodonStatus {
  reblog: MastodonStatus | null;
  content: string;
  emojis: MastodonEmoji[];
  created_at: string;
  account: MastodonAccount;
  media_attachments: MastodonMediaAttachment[];
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
}

export interface MastodonAccount {
  avatar: string;
  display_name: string;
  emojis: MastodonEmoji[];
  acct: string;
}

export interface MastodonEmoji {
  shortcode: string;
  url: string;
}

export interface MastodonMediaAttachment {
  type: 'image' | 'video' | 'gifv' | 'audio';
  url: string;
  preview_url: string;
  description: string;
}
