export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  theme: 'light' | 'dark';
}

export interface PostData {
  id: string;
  content: string;
  created_at: string;
  account: {
    display_name: string;
    username: string;
    acct: string;
    avatar: string;
    url: string;
    emojis?: Array<{
      shortcode: string;
      url: string;
    }>;
  };
  media_attachments: Array<{
    id: string;
    type: 'image' | 'video' | 'gifv';
    url: string;
    preview_url: string;
    description?: string;
  }>;
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  reblog?: PostData;
  emojis?: Array<{
    shortcode: string;
    url: string;
  }>;
}

