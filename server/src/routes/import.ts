import { Router } from 'express';
import multer from 'multer';
import { db, transaction } from '../db';
import { parseManuscript, ParsedNovel } from '../import/parse';
import { scheduleVaultSync } from '../sync/vault';

export const importRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

interface CreatedSummary {
  novelId: number;
  title: string;
  chapterCount: number;
  sceneCount: number;
  totalWords: number;
}

function createNovel(parsed: ParsedNovel, titleOverride?: string): CreatedSummary {
  const title = titleOverride?.trim() || parsed.title;
  let novelId = 0;
  let sceneCount = 0;
  transaction(() => {
    const n = db
      .prepare('INSERT INTO novels (title, author, description) VALUES (?, ?, ?)')
      .run(title, parsed.author, '');
    novelId = Number(n.lastInsertRowid);
    sceneCount = insertChapters(novelId, parsed, 0);
  });
  scheduleVaultSync(novelId);
  return { novelId, title, chapterCount: parsed.chapters.length, sceneCount, totalWords: parsed.totalWords };
}

function appendToNovel(novelId: number, parsed: ParsedNovel): CreatedSummary {
  const novel = db.prepare('SELECT title FROM novels WHERE id = ?').get(novelId) as
    | { title: string }
    | undefined;
  if (!novel) throw new Error(`Novel ${novelId} not found`);
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM chapters WHERE novel_id = ?')
    .get(novelId) as { m: number };
  let sceneCount = 0;
  transaction(() => {
    sceneCount = insertChapters(novelId, parsed, max.m + 1);
  });
  scheduleVaultSync(novelId);
  return { novelId, title: novel.title, chapterCount: parsed.chapters.length, sceneCount, totalWords: parsed.totalWords };
}

function insertChapters(novelId: number, parsed: ParsedNovel, startOrder: number): number {
  const chapterStmt = db.prepare('INSERT INTO chapters (novel_id, title, sort_order) VALUES (?, ?, ?)');
  const sceneStmt = db.prepare(
    'INSERT INTO scenes (chapter_id, title, content, word_count, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  let scenes = 0;
  parsed.chapters.forEach((chapter, ci) => {
    const c = chapterStmt.run(novelId, chapter.title, startOrder + ci);
    chapter.scenes.forEach((scene, si) => {
      sceneStmt.run(Number(c.lastInsertRowid), scene.title, scene.html, scene.words, si);
      scenes++;
    });
  });
  return scenes;
}

// POST /api/import  (multipart: file; fields: dryRun, novelId?, title?)
importRouter.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = await parseManuscript(req.file.buffer, req.file.originalname);

    if (String(req.body.dryRun) === 'true') {
      return res.json({
        title: parsed.title,
        author: parsed.author,
        totalWords: parsed.totalWords,
        chapters: parsed.chapters.map((c) => ({
          title: c.title,
          sceneCount: c.scenes.length,
          words: c.scenes.reduce((s, sc) => s + sc.words, 0),
          sceneTitles: c.scenes.slice(0, 8).map((s) => s.title),
        })),
      });
    }

    const novelId = req.body.novelId ? Number(req.body.novelId) : null;
    const result = novelId
      ? appendToNovel(novelId, parsed)
      : createNovel(parsed, typeof req.body.title === 'string' ? req.body.title : undefined);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
