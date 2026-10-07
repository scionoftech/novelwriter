import { Router } from 'express';
import { db, touchNovelForScene, transaction } from '../db';
import { scheduleVaultSync, novelIdOfScene } from '../sync/vault';
import { countWords } from '../util/text';

export const snapshotsRouter = Router();

snapshotsRouter.get('/scene/:sceneId', (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, scene_id, label, word_count, created_at FROM snapshots WHERE scene_id = ? ORDER BY created_at DESC, id DESC'
    )
    .all(req.params.sceneId);
  res.json(rows);
});

snapshotsRouter.post('/scene/:sceneId', (req, res) => {
  const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(req.params.sceneId) as
    | { content: string; word_count: number }
    | undefined;
  if (!scene) return res.status(404).json({ error: 'scene not found' });
  const { label = '' } = req.body ?? {};
  const result = db
    .prepare('INSERT INTO snapshots (scene_id, label, content, word_count) VALUES (?, ?, ?, ?)')
    .run(req.params.sceneId, String(label), scene.content, scene.word_count);
  res.json(
    db
      .prepare('SELECT id, scene_id, label, word_count, created_at FROM snapshots WHERE id = ?')
      .get(result.lastInsertRowid)
  );
});

snapshotsRouter.get('/:id', (req, res) => {
  const snap = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(req.params.id);
  if (!snap) return res.status(404).json({ error: 'not found' });
  res.json(snap);
});

// Restore a snapshot into its scene (auto-snapshots the current content first)
snapshotsRouter.post('/:id/restore', (req, res) => {
  const snap = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(req.params.id) as
    | { scene_id: number; content: string }
    | undefined;
  if (!snap) return res.status(404).json({ error: 'not found' });
  const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(snap.scene_id) as
    | { content: string; word_count: number }
    | undefined;
  if (!scene) return res.status(404).json({ error: 'scene not found' });
  transaction(() => {
    db.prepare('INSERT INTO snapshots (scene_id, label, content, word_count) VALUES (?, ?, ?, ?)').run(
      snap.scene_id,
      'Before restore',
      scene.content,
      scene.word_count
    );
    db.prepare(
      "UPDATE scenes SET content = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(snap.content, countWords(snap.content), snap.scene_id);
  });
  touchNovelForScene(snap.scene_id);
  scheduleVaultSync(novelIdOfScene(snap.scene_id));
  res.json(db.prepare('SELECT * FROM scenes WHERE id = ?').get(snap.scene_id));
});

snapshotsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM snapshots WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
