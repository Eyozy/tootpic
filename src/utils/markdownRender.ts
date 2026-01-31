type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type RenderOptions = {
  preferLinkHref?: boolean;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeHttpUrl(href: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(href);
}

function escapeHtmlAttr(text: string): string {
  // Attribute escape: keep it simple and strict.
  return escapeHtml(text);
}

function normalizeHexColor(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) return null;
  return value.toLowerCase();
}

type ColorPlaceholders = {
  text: string;
  placeholders: string[];
};

function normalizeEscapedColorTags(text: string): string {
  let normalized = text;
  normalized = normalized.replace(
    /&lt;font\s+[^&]*?color\s*=\s*["']\s*(#[0-9a-fA-F]{3,6})\s*["'][^&]*&gt;([\s\S]*?)&lt;\/font&gt;/gi,
    (_m, color, inner) => `<font color="${color}">${inner}</font>`,
  );
  normalized = normalized.replace(
    /&lt;span\s+[^&]*?style\s*=\s*["'][^"']*color\s*:\s*(#[0-9a-fA-F]{3,6})[^"']*["'][^&]*&gt;([\s\S]*?)&lt;\/span&gt;/gi,
    (_m, color, inner) => `<span style="color: ${color}">${inner}</span>`,
  );
  return normalized;
}

function extractColorTags(markdown: string): ColorPlaceholders {
  const placeholders: string[] = [];
  let text = markdown;

  const replaceWithPlaceholder = (color: string, inner: string) => {
    const safeColor = normalizeHexColor(color);
    if (!safeColor) return inner;
    const safeInner = escapeHtml(inner);
    const token = `@@_COLOR_${placeholders.length}_@@`;
    placeholders.push(`<span style="color: ${safeColor}">${safeInner}</span>`);
    return token;
  };

  text = text.replace(
    /<font\s+[^>]*?color\s*=\s*["']\s*(#[0-9a-fA-F]{3,6})\s*["'][^>]*>([\s\S]*?)<\/font>/gi,
    (_m, color, inner) => replaceWithPlaceholder(color, inner),
  );

  text = text.replace(
    /<span\s+[^>]*style\s*=\s*["'][^"']*color\s*:\s*(#[0-9a-fA-F]{3,6})[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_m, color, inner) => replaceWithPlaceholder(color, inner),
  );

  return { text, placeholders };
}

function headingClass(level: HeadingLevel): string {
  // Keep classes conservative to avoid disrupting existing layout.
  switch (level) {
    case 1:
      return 'mt-3 mb-1 text-xl font-bold';
    case 2:
      return 'mt-3 mb-1 text-lg font-bold';
    case 3:
      return 'mt-2 mb-1 text-base font-semibold';
    default:
      return 'mt-2 mb-1 text-sm font-semibold';
  }
}

function inlineRender(escaped: string, options?: RenderOptions): string {
  // 1) Inline code: protect it first.
  const codeSpans: string[] = [];
  const withCodePlaceholders = escaped.replace(/`([^`]+?)`/g, (_m, code) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code class="px-1 py-0.5 rounded bg-gray-100 font-mono text-[0.95em]">${code}</code>`);
    return `@@_CODE_${idx}_@@`;
  });

  // 2) Markdown images: protect them before linkify.
  const mdImages: string[] = [];
  const withImagePlaceholders = withCodePlaceholders.replace(/!\[([^\]]*?)\]\((https?:\/\/[^\s]+?)\)/g, (_m, alt, href) => {
    const cleanHref = String(href).trim();
    if (!isSafeHttpUrl(cleanHref)) return _m;
    const idx = mdImages.length;
    const safeAlt = escapeHtml(alt || '');
    mdImages.push(
      `<img class="mt-2 mb-2 rounded max-w-full" src="${escapeHtmlAttr(cleanHref)}" alt="${safeAlt}" loading="lazy" onerror="this.onerror=null; this.replaceWith(document.createTextNode(this.alt||''))">`,
    );
    return `@@_MDIMG_${idx}_@@`;
  });

  // 3) Markdown links: protect them before linkify (handle URLs with parentheses).
  const mdLinks: string[] = [];
  const withLinkPlaceholders = withImagePlaceholders.replace(/\[([^\]]+?)\]\((https?:\/\/[^\s]+?)\)/g, (_m, text, href) => {
    const cleanHref = String(href).trim();
    if (!isSafeHttpUrl(cleanHref)) return _m; // keep as text

    const idx = mdLinks.length;
    const linkText = options?.preferLinkHref ? cleanHref : (String(text || '').trim() || cleanHref);
    mdLinks.push(
      `<a class="url" href="${escapeHtmlAttr(cleanHref)}" target="_blank" rel="nofollow noopener noreferrer">${linkText}</a>`,
    );
    return `@@_MDLINK_${idx}_@@`;
  });

  // 3) Bilibili BV id -> link
  // BV is typically 12 chars total (BV + 10 base58-like chars). Keep it permissive.
  const withBvLinks = withLinkPlaceholders.replace(/\bBV[0-9A-Za-z]{10}\b/g, (bv) => {
    const href = `https://www.bilibili.com/video/${bv}`;
    return `<a class="url" href="${escapeHtmlAttr(href)}" target="_blank" rel="nofollow noopener noreferrer">${bv}</a>`;
  });

  // 3) Bare URL linkify (avoid capturing trailing punctuation in common cases).
  const linkified = withBvLinks.replace(/\bhttps?:\/\/[^\s<>"']+/gi, (rawUrl) => {
    // Trim common trailing punctuation while keeping balanced parentheses.
    let url = rawUrl;
    while (/[.,;:!?]+$/.test(url)) url = url.replace(/[.,;:!?]+$/, '');
    // If we end with ")", only keep it when parentheses are balanced.
    // Example: https://a.com/foo_(bar) should keep the final ')'.
    while (url.endsWith(')')) {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes > opens) url = url.slice(0, -1);
      else break;
    }
    if (!isSafeHttpUrl(url)) return rawUrl;
    return `<a class="url" href="${escapeHtmlAttr(url)}" target="_blank" rel="nofollow noopener noreferrer">${url}</a>`;
  });

  // 4) Bold / italic (optional but useful for readability).
  // These are intentionally simple (no nesting guarantees).
  const withEmphasis = linkified
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>');

  // 5) Restore markdown link placeholders.
  const restoredLinks = withEmphasis.replace(/@@_MDLINK_(\d+)_@@/g, (_m, n) => mdLinks[Number(n)] || _m);

  // 6) Restore markdown image placeholders.
  const restoredImages = restoredLinks.replace(/@@_MDIMG_(\d+)_@@/g, (_m, n) => mdImages[Number(n)] || _m);

  // 7) Restore code placeholders.
  return restoredImages.replace(/@@_CODE_(\d+)_@@/g, (_m, n) => codeSpans[Number(n)] || _m);
}

/**
 * Extremely small (and intentionally limited) Markdown -> HTML renderer.
 * - Designed for screenshot rendering (snapdom) and avoids unsafe HTML passthrough.
 * - Only supports a small subset we need for Ech0 posts.
 */
export function renderMarkdownToHtml(markdown: string, options?: RenderOptions): string {
  const normalized = String(markdown ?? '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return '';

  // Extract fenced code blocks first to avoid other inline parsing inside them.
  const codeBlocks: string[] = [];
  let working = normalized.replace(/```([a-z0-9_-]+)?\n([\s\S]*?)```/gi, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre class="mt-2 mb-2 p-3 rounded bg-gray-100 overflow-x-auto"><code class="font-mono text-sm">${escapeHtml(
        code,
      )}</code></pre>`,
    );
    return `@@_CODEBLOCK_${idx}_@@`;
  });

  // Keep callout markers as-is to match Ech0's current rendering.

  // Normalize escaped color tags (e.g., &lt;font color=\"#hex\"&gt;) before color extraction.
  working = normalizeEscapedColorTags(working);

  const colorExtraction = extractColorTags(working);
  working = colorExtraction.text;

  // Escape so we never execute arbitrary HTML from remote content.
  const escaped = escapeHtml(working);

  const restoreColors = (html: string) =>
    html.replace(/@@_COLOR_(\d+)_@@/g, (_m, n) => colorExtraction.placeholders[Number(n)] || _m);

  const lines = escaped.split('\n');
  const out: string[] = [];

  let para: string[] = [];
  let quote: string[] = [];
  let listItems: string[] = [];
  let inList = false;

  const flushPara = () => {
    if (para.length === 0) return;
    const html = restoreColors(inlineRender(para.join('<br>'), options));
    out.push(`<p class="leading-relaxed">${html}</p>`);
    para = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    const html = restoreColors(inlineRender(quote.join('<br>'), options));
    out.push(`<blockquote class="border-l-4 border-gray-300 pl-3 text-gray-700">${html}</blockquote>`);
    quote = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems.map(item => `<li class="ml-4">${restoreColors(inlineRender(item, options))}</li>`).join('');
    out.push(`<ul class="list-disc pl-5 my-2">${items}</ul>`);
    listItems = [];
    inList = false;
  };

  for (const rawLine of lines) {
    // Restore code blocks as standalone block elements.
    const codeBlockMatch = rawLine.match(/^@@_CODEBLOCK_(\d+)_@@$/);
    if (codeBlockMatch) {
      flushPara();
      flushQuote();
      flushList();
      out.push(codeBlocks[Number(codeBlockMatch[1])] || rawLine);
      continue;
    }

    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushQuote();
      flushList();
      continue;
    }

    // Blockquotes (note: '>' becomes '&gt;' after escaping)
    const quoteMatch = line.match(/^(&gt;)+\s?(.*)$/);
    if (quoteMatch) {
      flushPara();
      flushList();
      quote.push(quoteMatch[2] || '');
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushPara();
      flushQuote();
      flushList();
      const level = headingMatch[1].length as HeadingLevel;
      const text = restoreColors(inlineRender(headingMatch[2].trim(), options));
      out.push(`<h${level} class="${headingClass(level)}">${text}</h${level}>`);
      continue;
    }

    // List items (note: '- ' or '* ' becomes '&#39; ' or '* ' after escaping, but we match the original markdown pattern)
    // Actually, after escapeHtml, '- ' stays as '- ' because hyphen is not escaped
    const listMatch = line.match(/^[\-\*]\s+(.+)$/);
    if (listMatch) {
      flushPara();
      flushQuote();
      listItems.push(listMatch[1]);
      inList = true;
      continue;
    }

    // If we're in a list but this line doesn't match list pattern, flush the list
    if (inList) {
      flushList();
    }

    para.push(line);
  }

  flushPara();
  flushQuote();
  flushList();

  return out.join('\n');
}
