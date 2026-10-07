import { Router } from 'express';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { db } from '../db';
import { htmlToMarkdown, htmlToParagraphRuns, htmlToText } from '../util/text';

export const exportRouter = Router();

interface NovelRow {
  id: number;
  title: string;
  author: string;
  description: string;
}
interface ChapterRow {
  id: number;
  title: string;
}
interface SceneRow {
  id: number;
  title: string;
  content: string;
}

function loadNovel(novelId: string) {
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId) as NovelRow | undefined;
  if (!novel) return null;
  const chapters = db
    .prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY sort_order, id')
    .all(novelId) as unknown as ChapterRow[];
  const sceneStmt = db.prepare('SELECT * FROM scenes WHERE chapter_id = ? ORDER BY sort_order, id');
  return {
    novel,
    chapters: chapters.map((c) => ({ ...c, scenes: sceneStmt.all(c.id) as unknown as SceneRow[] })),
  };
}

/** Content-Disposition value safe for non-Latin titles (ASCII fallback + RFC 5987 name). */
function attachment(title: string, ext: string): string {
  const name = slug(title);
  const ascii = name.replace(/[^\x20-\x7e]+/g, '').replace(/^-+|-+$/g, '') || 'novel';
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(name)}.${ext}`;
}

function slug(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'novel';
}

exportRouter.get('/:novelId', async (req, res) => {
  const data = loadNovel(req.params.novelId);
  if (!data) return res.status(404).json({ error: 'not found' });
  const format = String(req.query.format || 'markdown');
  const { novel, chapters } = data;

  if (format === 'markdown' || format === 'text') {
    const md = format === 'markdown';
    const parts: string[] = [];
    parts.push(md ? `# ${novel.title}` : novel.title.toUpperCase());
    if (novel.author) parts.push(md ? `*by ${novel.author}*` : `by ${novel.author}`);
    for (const chapter of chapters) {
      parts.push(md ? `\n## ${chapter.title}` : `\n\n${chapter.title.toUpperCase()}`);
      chapter.scenes.forEach((scene, i) => {
        if (i > 0) parts.push(md ? '\n---' : '\n* * *');
        const body = md ? htmlToMarkdown(scene.content) : htmlToText(scene.content);
        if (body) parts.push('\n' + body);
      });
    }
    const ext = md ? 'md' : 'txt';
    res.setHeader('Content-Type', md ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', attachment(novel.title, ext));
    return res.send(parts.join('\n') + '\n');
  }

  if (format === 'docx') {
    const children: Paragraph[] = [];
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [new TextRun(novel.title)],
      })
    );
    if (novel.author) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `by ${novel.author}`, italics: true })],
        })
      );
    }
    for (const chapter of chapters) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: true,
          children: [new TextRun(chapter.title)],
        })
      );
      chapter.scenes.forEach((scene, i) => {
        if (i > 0) {
          children.push(
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('* * *')] })
          );
        }
        for (const runs of htmlToParagraphRuns(scene.content)) {
          children.push(
            new Paragraph({
              spacing: { after: 200 },
              children: runs.map(
                (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic })
              ),
            })
          );
        }
      });
    }
    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', attachment(novel.title, 'docx'));
    return res.send(buffer);
  }

  res.status(400).json({ error: `unknown format: ${format}` });
});
