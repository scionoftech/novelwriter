const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
};

function safeCodePoint(code: number, original: string): string {
  // fromCodePoint throws on anything outside the Unicode range
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : original;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (m, n) => safeCodePoint(parseInt(n, 10), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => safeCodePoint(parseInt(n, 16), m))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** Convert TipTap HTML to plain text with paragraph breaks. */
export function htmlToText(html: string): string {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|blockquote)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(html: string): number {
  const text = htmlToText(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Parse the inner HTML of one paragraph into styled runs (handles em/i/strong/b). */
export function parseInlineRuns(inner: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let bold = 0;
  let italic = 0;
  const parts = inner.split(/(<\/?(?:em|i|strong|b)(?:\s[^>]*)?>)/gi);
  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^<(\/?)(em|i|strong|b)/i);
    if (m) {
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      const isBold = tag === 'strong' || tag === 'b';
      if (isBold) bold += closing ? -1 : 1;
      else italic += closing ? -1 : 1;
      continue;
    }
    const text = decodeEntities(part.replace(/<[^>]+>/g, ''));
    if (text) runs.push({ text, bold: bold > 0, italic: italic > 0 });
  }
  return runs;
}

/** Split TipTap HTML into paragraphs of styled runs. */
export function htmlToParagraphRuns(html: string): InlineRun[][] {
  if (!html) return [];
  const paragraphs: InlineRun[][] = [];
  const blocks = html.split(/<\/(?:p|h[1-6]|blockquote|li)>/gi);
  for (const block of blocks) {
    const inner = block.replace(/^[\s\S]*?<(?:p|h[1-6]|blockquote|li)(?:\s[^>]*)?>/i, '');
    for (const line of inner.split(/<br\s*\/?>/gi)) {
      const runs = parseInlineRuns(line);
      if (runs.length) paragraphs.push(runs);
    }
  }
  return paragraphs;
}

function inlineMd(inner: string): string {
  return decodeEntities(
    inner
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:strong|b)(?:\s[^>]*)?>/gi, '**')
      .replace(/<\/?(?:em|i)(?:\s[^>]*)?>/gi, '*')
      .replace(/<\/?code(?:\s[^>]*)?>/gi, '`')
      .replace(/<[^>]+>/g, '')
  ).trim();
}

/** Convert TipTap HTML to Markdown (paragraphs, headings, quotes, lists, emphasis). */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const blocks: string[] = [];
  const re = /<(h[1-6]|p|blockquote|ul|ol)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0].toLowerCase().startsWith('<hr')) {
      blocks.push('---');
      continue;
    }
    const tag = m[1].toLowerCase();
    const inner = m[2];
    if (tag === 'p') {
      const t = inlineMd(inner);
      if (t) blocks.push(t);
    } else if (tag.startsWith('h')) {
      const t = inlineMd(inner);
      if (t) blocks.push(`${'#'.repeat(Number(tag[1]))} ${t}`);
    } else if (tag === 'blockquote') {
      const lines = inner
        .split(/<\/p>/gi)
        .map((p) => inlineMd(p))
        .filter(Boolean);
      if (lines.length) blocks.push(lines.map((l) => `> ${l.replace(/\n/g, '\n> ')}`).join('\n>\n'));
    } else if (tag === 'ul' || tag === 'ol') {
      const items = inner
        .split(/<\/li>/gi)
        .map((li) => inlineMd(li))
        .filter(Boolean);
      if (items.length) {
        blocks.push(items.map((it, i) => (tag === 'ul' ? `- ${it}` : `${i + 1}. ${it}`)).join('\n'));
      }
    }
  }
  if (!blocks.length) {
    // Fallback for content without recognized block tags
    const t = htmlToText(html);
    return t;
  }
  return blocks.join('\n\n');
}

/** Convert plain text (with blank-line paragraph breaks) to TipTap-compatible HTML. */
export function textToHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .filter((p) => p !== '<p></p>')
    .join('');
}

function mdInlineToHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Convert Markdown to TipTap-compatible HTML (paragraphs, headings, quotes, lists, hr). */
export function markdownToHtml(md: string): string {
  if (!md.trim()) return '';
  const blocks = md.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const html: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/s);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${mdInlineToHtml(heading[2].trim())}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      html.push('<hr>');
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      const inner = trimmed
        .split('\n')
        .map((l) => l.replace(/^>\s?/, ''))
        .filter((l) => l.trim())
        .map((l) => `<p>${mdInlineToHtml(l)}</p>`)
        .join('');
      html.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }
    if (trimmed.split('\n').every((l) => /^[-*]\s+/.test(l))) {
      html.push(`<ul>${trimmed.split('\n').map((l) => `<li>${mdInlineToHtml(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`);
      continue;
    }
    if (trimmed.split('\n').every((l) => /^\d+\.\s+/.test(l))) {
      html.push(`<ol>${trimmed.split('\n').map((l) => `<li>${mdInlineToHtml(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
      continue;
    }
    html.push(`<p>${mdInlineToHtml(trimmed).replace(/\n/g, '<br>')}</p>`);
  }
  return html.join('');
}

export function tailTrim(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(text.length - maxChars);
  const firstBreak = cut.indexOf('\n');
  return '[…earlier text omitted…]\n' + (firstBreak > 0 ? cut.slice(firstBreak + 1) : cut);
}
