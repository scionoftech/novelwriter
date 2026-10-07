import { Router } from 'express';
import { db } from '../db';
import { scheduleVaultSync, novelIdOfCodex } from '../sync/vault';

export const codexRouter = Router();

const TYPES = ['character', 'location', 'item', 'lore', 'other'];

codexRouter.get('/novel/:novelId', (req, res) => {
  const entries = db
    .prepare('SELECT * FROM codex_entries WHERE novel_id = ? ORDER BY type, name')
    .all(req.params.novelId);
  res.json(entries);
});

codexRouter.post('/novel/:novelId', (req, res) => {
  const { name, type = 'character', aliases = [], description = '', always_include = false } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
  const safeType = TYPES.includes(type) ? type : 'other';
  const result = db
    .prepare(
      'INSERT INTO codex_entries (novel_id, type, name, aliases, description, always_include) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      req.params.novelId,
      safeType,
      name.trim(),
      JSON.stringify(Array.isArray(aliases) ? aliases : []),
      String(description),
      always_include ? 1 : 0
    );
  scheduleVaultSync(Number(req.params.novelId));
  res.json(db.prepare('SELECT * FROM codex_entries WHERE id = ?').get(result.lastInsertRowid));
});

codexRouter.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM codex_entries WHERE id = ?').get(req.params.id) as
    | { type: string; name: string; aliases: string; description: string; always_include: number }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { name, type, aliases, description, always_include } = req.body ?? {};
  db.prepare(
    `UPDATE codex_entries SET type = ?, name = ?, aliases = ?, description = ?, always_include = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(
    typeof type === 'string' && TYPES.includes(type) ? type : existing.type,
    typeof name === 'string' && name.trim() ? name.trim() : existing.name,
    Array.isArray(aliases) ? JSON.stringify(aliases) : existing.aliases,
    typeof description === 'string' ? description : existing.description,
    always_include === undefined ? existing.always_include : always_include ? 1 : 0,
    req.params.id
  );
  scheduleVaultSync(novelIdOfCodex(req.params.id));
  res.json(db.prepare('SELECT * FROM codex_entries WHERE id = ?').get(req.params.id));
});

codexRouter.delete('/:id', (req, res) => {
  const novelId = novelIdOfCodex(req.params.id);
  db.prepare('DELETE FROM codex_entries WHERE id = ?').run(req.params.id);
  scheduleVaultSync(novelId);
  res.json({ ok: true });
});
