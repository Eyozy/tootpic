export function detectsMarkdown(text: string): boolean {
  const input = String(text || '');
  if (!input.trim()) return false;

  return (
    /(^|\n)\s{0,3}#{1,6}\s+\S/.test(input) || // headings
    /(^|\n)\s*>\s+/.test(input) || // blockquote
    /(^|\n)\s*[-*+]\s+\S/.test(input) || // list
    /(^|\n)\s*\d+\.\s+\S/.test(input) || // ordered list
    /(^|\n)```/.test(input) || // code fence
    /\[([^\]]+?)\]\((https?:\/\/[^)]+?)\)/i.test(input) || // markdown link
    /!\[[^\]]*?\]\((https?:\/\/[^)]+?)\)/i.test(input) || // markdown image
    /\*\*[^*]+\*\*/.test(input) || // bold
    /\*[^*]+\*/.test(input) || // italic
    /`[^`]+`/.test(input) || // inline code
    /~~[^~]+~~/.test(input) // strikethrough
  );
}

export function computeMediaGridStyle({
  count,
  hasVideosOrGifs,
}: {
  count: number;
  hasVideosOrGifs: boolean;
}): { columns: string; aspectRatio?: string } {
  const columns = count > 1 ? '1fr 1fr' : '1fr';
  let aspectRatio: string | undefined;
  if (count >= 2 && !hasVideosOrGifs) {
    aspectRatio = '3 / 2';
  }
  return { columns, aspectRatio };
}

export function mapVideoThumbnailData(
  items: Array<{ attachmentIndex: number; src: string; isVideo: boolean }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of items) {
    if (!item.isVideo) continue;
    if (!item.src || !item.src.startsWith('data:')) continue;
    map[String(item.attachmentIndex)] = item.src;
  }
  return map;
}

export function formatVideoAlt(index: number): string {
  const safeIndex = Number.isFinite(index) ? index : 0;
  return `Video ${safeIndex + 1}`;
}
