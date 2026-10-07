/** HTML ↔ Markdown conversion for the editor's markdown mode.
 *  Covers what TipTap StarterKit produces for prose: paragraphs, em/strong,
 *  headings, blockquotes, lists, and horizontal rules. */

function inlineToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(inlineToMd).join('');
  switch (el.tagName) {
    case 'EM':
    case 'I':
      return inner ? `*${inner}*` : '';
    case 'STRONG':
    case 'B':
      return inner ? `**${inner}**` : '';
    case 'CODE':
      return inner ? `\`${inner}\`` : '';
    case 'BR':
      return '\n';
    default:
      return inner;
  }
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: string[] = [];
  const walk = (nodes: NodeListOf<ChildNode> | ChildNode[]) => {
    for (const node of Array.from(nodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        const text = node.textContent?.trim();
        if (text) blocks.push(text);
        continue;
      }
      const el = node as HTMLElement;
      switch (el.tagName) {
        case 'P': {
          const text = inlineToMd(el).trim();
          if (text) blocks.push(text);
          break;
        }
        case 'H1':
        case 'H2':
        case 'H3':
        case 'H4':
        case 'H5':
        case 'H6': {
          const level = Number(el.tagName[1]);
          blocks.push(`${'#'.repeat(level)} ${inlineToMd(el).trim()}`);
          break;
        }
        case 'BLOCKQUOTE': {
          const innerBlocks: string[] = [];
          for (const child of Array.from(el.children)) {
            const t = inlineToMd(child).trim();
            if (t) innerBlocks.push(t);
          }
          if (innerBlocks.length) blocks.push(innerBlocks.map((b) => `> ${b}`).join('\n>\n'));
          break;
        }
        case 'UL':
          blocks.push(
            Array.from(el.querySelectorAll(':scope > li'))
              .map((li) => `- ${inlineToMd(li).trim()}`)
              .join('\n')
          );
          break;
        case 'OL':
          blocks.push(
            Array.from(el.querySelectorAll(':scope > li'))
              .map((li, i) => `${i + 1}. ${inlineToMd(li).trim()}`)
              .join('\n')
          );
          break;
        case 'HR':
          blocks.push('---');
          break;
        default:
          walk(el.childNodes);
      }
    }
  };
  walk(doc.body.childNodes);
  return blocks.filter((b) => b.trim()).join('\n\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineToHtml(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

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
      html.push(`<h${level}>${inlineToHtml(heading[2].trim())}</h${level}>`);
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
        .join('\n')
        .split(/\n{1,}/)
        .filter((l) => l.trim())
        .map((l) => `<p>${inlineToHtml(l)}</p>`)
        .join('');
      html.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }
    if (trimmed.split('\n').every((l) => /^[-*]\s+/.test(l))) {
      html.push(
        `<ul>${trimmed
          .split('\n')
          .map((l) => `<li>${inlineToHtml(l.replace(/^[-*]\s+/, ''))}</li>`)
          .join('')}</ul>`
      );
      continue;
    }
    if (trimmed.split('\n').every((l) => /^\d+\.\s+/.test(l))) {
      html.push(
        `<ol>${trimmed
          .split('\n')
          .map((l) => `<li>${inlineToHtml(l.replace(/^\d+\.\s+/, ''))}</li>`)
          .join('')}</ol>`
      );
      continue;
    }
    html.push(`<p>${inlineToHtml(trimmed).replace(/\n/g, '<br>')}</p>`);
  }
  return html.join('');
}

export function countMdWords(md: string): number {
  const text = md.replace(/[#>*_`-]/g, ' ').trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
