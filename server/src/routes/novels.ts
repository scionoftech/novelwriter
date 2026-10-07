import { Router } from 'express';
import { db, touchNovelForScene, transaction } from '../db';
import { scheduleVaultSync, removeNovelFromVault, novelIdOfChapter, novelIdOfScene } from '../sync/vault';
import { countWords } from '../util/text';

export const novelsRouter = Router();

// ---------- Novels ----------

novelsRouter.get('/', (_req, res) => {
  const novels = db
    .prepare(
      `SELECT n.*,
        (SELECT COALESCE(SUM(s.word_count), 0) FROM scenes s
          JOIN chapters c ON s.chapter_id = c.id WHERE c.novel_id = n.id) AS word_count,
        (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count
       FROM novels n ORDER BY n.updated_at DESC`
    )
    .all();
  res.json(novels);
});

novelsRouter.post('/', (req, res) => {
  const { title, author = '', description = '' } = req.body ?? {};
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title is required' });
  const result = db
    .prepare('INSERT INTO novels (title, author, description) VALUES (?, ?, ?)')
    .run(title.trim(), String(author), String(description));
  const novelId = Number(result.lastInsertRowid);
  // Start every novel with one chapter and one scene so writing can begin immediately.
  const ch = db.prepare("INSERT INTO chapters (novel_id, title, sort_order) VALUES (?, 'Chapter 1', 0)").run(novelId);
  db.prepare("INSERT INTO scenes (chapter_id, title, sort_order) VALUES (?, 'Scene 1', 0)").run(Number(ch.lastInsertRowid));
  res.json(db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId));
});

novelsRouter.get('/:id', (req, res) => {
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id);
  if (!novel) return res.status(404).json({ error: 'not found' });
  res.json(novel);
});

novelsRouter.put('/:id', (req, res) => {
  const { title, author, description } = req.body ?? {};
  const existing = db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id) as
    | { title: string; author: string; description: string }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const newTitle = typeof title === 'string' && title.trim() ? title : existing.title;
  db.prepare(
    "UPDATE novels SET title = ?, author = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newTitle, author ?? existing.author, description ?? existing.description, req.params.id);
  // The vault folder is named after the title, so drop the old one on rename.
  if (newTitle !== existing.title) removeNovelFromVault(Number(req.params.id), existing.title);
  scheduleVaultSync(Number(req.params.id));
  res.json(db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id));
});

novelsRouter.delete('/:id', (req, res) => {
  const novel = db.prepare('SELECT title FROM novels WHERE id = ?').get(req.params.id) as
    | { title: string }
    | undefined;
  db.prepare('DELETE FROM novels WHERE id = ?').run(req.params.id);
  if (novel) removeNovelFromVault(Number(req.params.id), novel.title);
  res.json({ ok: true });
});

// Full tree: chapters with nested scenes (content omitted for lightness)
novelsRouter.get('/:id/tree', (req, res) => {
  const chapters = db
    .prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY sort_order, id')
    .all(req.params.id) as { id: number }[];
  const sceneStmt = db.prepare(
    `SELECT id, chapter_id, title, summary, status, pov, sort_order, word_count, updated_at
     FROM scenes WHERE chapter_id = ? ORDER BY sort_order, id`
  );
  res.json(chapters.map((c) => ({ ...c, scenes: sceneStmt.all(c.id) })));
});

// ---------- Chapters ----------

novelsRouter.post('/:id/chapters', (req, res) => {
  const { title = 'New Chapter' } = req.body ?? {};
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM chapters WHERE novel_id = ?')
    .get(req.params.id) as { m: number };
  const result = db
    .prepare('INSERT INTO chapters (novel_id, title, sort_order) VALUES (?, ?, ?)')
    .run(req.params.id, String(title), max.m + 1);
  scheduleVaultSync(Number(req.params.id));
  res.json(db.prepare('SELECT * FROM chapters WHERE id = ?').get(result.lastInsertRowid));
});

novelsRouter.put('/chapters/:chapterId', (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title === 'string') {
    db.prepare('UPDATE chapters SET title = ? WHERE id = ?').run(title, req.params.chapterId);
    scheduleVaultSync(novelIdOfChapter(req.params.chapterId));
  }
  res.json(db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.chapterId));
});

novelsRouter.delete('/chapters/:chapterId', (req, res) => {
  const novelId = novelIdOfChapter(req.params.chapterId);
  db.prepare('DELETE FROM chapters WHERE id = ?').run(req.params.chapterId);
  scheduleVaultSync(novelId);
  res.json({ ok: true });
});

// Reorder chapters: body { orderedIds: number[] }
novelsRouter.put('/:id/chapters/reorder', (req, res) => {
  const { orderedIds } = req.body ?? {};
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds required' });
  const stmt = db.prepare('UPDATE chapters SET sort_order = ? WHERE id = ? AND novel_id = ?');
  transaction(() => {
    orderedIds.forEach((id: number, i: number) => stmt.run(i, id, req.params.id));
  });
  scheduleVaultSync(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Scenes ----------

novelsRouter.post('/chapters/:chapterId/scenes', (req, res) => {
  const { title = 'New Scene' } = req.body ?? {};
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM scenes WHERE chapter_id = ?')
    .get(req.params.chapterId) as { m: number };
  const result = db
    .prepare('INSERT INTO scenes (chapter_id, title, sort_order) VALUES (?, ?, ?)')
    .run(req.params.chapterId, String(title), max.m + 1);
  scheduleVaultSync(novelIdOfChapter(req.params.chapterId));
  res.json(db.prepare('SELECT * FROM scenes WHERE id = ?').get(result.lastInsertRowid));
});

novelsRouter.get('/scenes/:sceneId', (req, res) => {
  const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(req.params.sceneId);
  if (!scene) return res.status(404).json({ error: 'not found' });
  res.json(scene);
});

novelsRouter.put('/scenes/:sceneId', (req, res) => {
  const sceneId = Number(req.params.sceneId);
  const existing = db.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId) as
    | { title: string; content: string; summary: string; status: string; pov: string }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { title, content, summary, status, pov } = req.body ?? {};
  const newContent = typeof content === 'string' ? content : existing.content;
  db.prepare(
    `UPDATE scenes SET title = ?, content = ?, summary = ?, status = ?, pov = ?,
       word_count = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    typeof title === 'string' ? title : existing.title,
    newContent,
    typeof summary === 'string' ? summary : existing.summary,
    typeof status === 'string' ? status : existing.status,
    typeof pov === 'string' ? pov : existing.pov,
    countWords(newContent),
    sceneId
  );
  touchNovelForScene(sceneId);
  scheduleVaultSync(novelIdOfScene(sceneId));
  res.json(db.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId));
});

novelsRouter.delete('/scenes/:sceneId', (req, res) => {
  const novelId = novelIdOfScene(req.params.sceneId);
  db.prepare('DELETE FROM scenes WHERE id = ?').run(req.params.sceneId);
  scheduleVaultSync(novelId);
  res.json({ ok: true });
});

// Reorder/move scenes: body { chapterId, orderedIds } — moves scenes into chapterId in given order
novelsRouter.put('/chapters/:chapterId/scenes/reorder', (req, res) => {
  const { orderedIds } = req.body ?? {};
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds required' });
  const novelId = novelIdOfChapter(req.params.chapterId);
  if (novelId == null) return res.status(404).json({ error: 'chapter not found' });
  // Scenes may move between chapters, but only within the same novel.
  const stmt = db.prepare(
    `UPDATE scenes SET chapter_id = ?, sort_order = ?
     WHERE id = ? AND chapter_id IN (SELECT id FROM chapters WHERE novel_id = ?)`
  );
  transaction(() => {
    orderedIds.forEach((id: number, i: number) => stmt.run(req.params.chapterId, i, id, novelId));
  });
  scheduleVaultSync(novelIdOfChapter(req.params.chapterId));
  res.json({ ok: true });
});
