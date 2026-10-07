import path from 'path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { countWords, decodeEntities, htmlToText, markdownToHtml } from '../util/text';

export interface ParsedScene {
  title: string;
  html: string;
  words: number;
}
export interface ParsedChapter {
  title: string;
  scenes: ParsedScene[];
}
export interface ParsedNovel {
  title: string;
  author: string;
  chapters: ParsedChapter[];
  totalWords: number;
}

interface Block {
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'hr';
  html: string;
  text: string;
}

// ---------- extraction per format ----------

async function extractHtml(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.docx': {
      const result = await mammoth.convertToHtml({ buffer });
      return result.value;
    }
    case '.md':
    case '.markdown':
      return markdownToHtml(buffer.toString('utf8'));
    case '.txt':
    case '.text':
      return plainTextToHtml(buffer.toString('utf8'));
    case '.pdf': {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return plainTextToHtml(result.text);
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }
    default:
      throw new Error(`Unsupported file type "${ext}" — use .docx, .pdf, .md, or .txt`);
  }
}

function plainTextToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '');
  const lines = normalized.split('\n');
  const blankLines = lines.filter((l) => !l.trim()).length;

  // Documents with blank-line paragraph separation: group runs of non-empty lines.
  // Hard-wrapped documents without blank lines (common in PDFs): one paragraph per line,
  // merging lines that don't end a sentence.
  let paragraphs: string[];
  if (blankLines >= 2 || lines.length < 10) {
    // Blank-line-separated paragraphs; chapter markers and scene breaks always
    // stand alone even when they share a group with body text (common in PDFs).
    paragraphs = [];
    for (const group of normalized.split(/\n\s*\n+/)) {
      let current = '';
      for (const raw of group.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (isBreakText(line) || isChapterText(line)) {
          if (current) paragraphs.push(current);
          current = '';
          paragraphs.push(line);
          continue;
        }
        current = current ? `${current} ${line}` : line;
      }
      if (current) paragraphs.push(current);
    }
  } else {
    paragraphs = [];
    let current = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (isBreakText(line) || isChapterText(line)) {
        if (current) paragraphs.push(current);
        current = '';
        paragraphs.push(line);
        continue;
      }
      current = current ? `${current} ${line}` : line;
      if (/[.!?"'”’]$/.test(line)) {
        paragraphs.push(current);
        current = '';
      }
    }
    if (current) paragraphs.push(current);
  }
  return paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
}

// ---------- structure detection ----------

const CHAPTER_RE =
  /^(chapter|part|book|act|prologue|epilogue|interlude)\b[\s.:—-]*([0-9]{1,4}|[ivxlcdm]{1,8}|[a-z]+)?[\s.:—-]*(.{0,60})?$/i;

function isChapterText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (CHAPTER_RE.test(t)) return true;
  if (/^\d{1,3}\.?$/.test(t)) return true; // bare "12" / "12."
  if (/^[IVXLCDM]{1,7}\.?$/.test(t)) return true; // bare roman numerals
  return false;
}

function isBreakText(text: string): boolean {
  const t = text.trim();
  return /^([*#~•⁂]\s*){1,7}$/.test(t) || /^[-—_=]{3,}$/.test(t) || t === '* * *';
}

function htmlToBlocks(html: string): Block[] {
  const cleaned = html.replace(/<img[^>]*>/gi, '').replace(/<a(?:\s[^>]*)?>([\s\S]*?)<\/a>/gi, '$1');
  const blocks: Block[] = [];
  const re = /<(h[1-6]|p|blockquote|ul|ol)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[0].toLowerCase().startsWith('<hr')) {
      blocks.push({ kind: 'hr', html: '', text: '' });
      continue;
    }
    const tag = m[1].toLowerCase();
    const inner = m[2];
    const text = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    if (!text) continue;
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      blocks.push({ kind: tag, html: `<${tag}>${inner}</${tag}>`, text });
    } else if (tag.startsWith('h')) {
      blocks.push({ kind: 'h3', html: `<h3>${inner}</h3>`, text });
    } else {
      // strip attributes but keep the block tag
      blocks.push({ kind: 'p', html: `<${tag}>${inner}</${tag}>`, text });
    }
  }
  return blocks;
}

function assemble(blocks: Block[], fallbackTitle: string): ParsedNovel {
  let title = fallbackTitle;
  let author = '';
  let i = 0;

  const laterHasChapter = (from: number) =>
    blocks.slice(from).some((b) => b.kind === 'h1' || b.kind === 'h2' || (b.kind === 'p' && isChapterText(b.text)));

  // Leading title followed by chapter structure → novel title (+ optional byline).
  // Either an h1, or a short title-looking paragraph (no sentence punctuation).
  const looksLikeTitle = (b: Block | undefined) =>
    !!b &&
    (b.kind === 'h1' ||
      (b.kind === 'p' && b.text.length <= 60 && !/[.!?]$/.test(b.text) && b.text.split(/\s+/).length <= 10));
  if (looksLikeTitle(blocks[0]) && !isChapterText(blocks[0].text) && laterHasChapter(1)) {
    title = blocks[0].text;
    i = 1;
    const by = blocks[i]?.text.match(/^by\s+(.{1,60})$/i);
    if (blocks[i] && by) {
      author = by[1].trim();
      i++;
    }
  }

  const chapters: ParsedChapter[] = [];
  let chapterTitle: string | null = null;
  let sceneTitle: string | null = null;
  let sceneHtml: string[] = [];
  let scenes: ParsedScene[] = [];

  const flushScene = () => {
    const html = sceneHtml.join('');
    if (html) {
      scenes.push({
        title: sceneTitle || `Scene ${scenes.length + 1}`,
        html,
        words: countWords(html),
      });
    }
    sceneTitle = null;
    sceneHtml = [];
  };
  const flushChapter = (nextTitle: string | null) => {
    flushScene();
    if (scenes.length) {
      chapters.push({
        title: chapterTitle ?? (chapters.length === 0 ? 'Chapter 1' : `Chapter ${chapters.length + 1}`),
        scenes,
      });
    }
    scenes = [];
    chapterTitle = nextTitle;
  };

  for (; i < blocks.length; i++) {
    const b = blocks[i];
    const isChapterHeading = b.kind === 'h1' || b.kind === 'h2' || (b.kind === 'p' && isChapterText(b.text));
    if (isChapterHeading) {
      // Content before the first heading becomes a prologue chapter
      if (chapterTitle === null && (scenes.length || sceneHtml.length)) {
        const preserved = chapters.length;
        flushChapter(b.text);
        if (chapters.length > preserved) chapters[chapters.length - 1].title = 'Prologue';
      } else {
        flushChapter(b.text);
      }
      continue;
    }
    if (b.kind === 'h3') {
      flushScene();
      sceneTitle = b.text;
      continue;
    }
    if (b.kind === 'hr' || isBreakText(b.text)) {
      flushScene();
      continue;
    }
    sceneHtml.push(b.html);
  }
  flushChapter(null);

  if (!chapters.length) throw new Error('No readable text found in the file');
  const totalWords = chapters.reduce((s, c) => s + c.scenes.reduce((x, sc) => x + sc.words, 0), 0);
  return { title, author, chapters, totalWords };
}

export async function parseManuscript(buffer: Buffer, filename: string): Promise<ParsedNovel> {
  const html = await extractHtml(buffer, filename);
  const blocks = htmlToBlocks(html);
  const fallback = path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' ').trim() || 'Imported Novel';
  const parsed = assemble(blocks, fallback);
  if (!htmlToText(parsed.chapters[0].scenes[0]?.html ?? '')) {
    throw new Error('No readable text found in the file');
  }
  return parsed;
}
