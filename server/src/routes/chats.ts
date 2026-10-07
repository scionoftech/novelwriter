import { Router } from 'express';
import { db } from '../db';

export const chatsRouter = Router();

chatsRouter.get('/novel/:novelId', (req, res) => {
  res.json(
    db
      .prepare('SELECT * FROM chats WHERE novel_id = ? ORDER BY created_at DESC, id DESC')
      .all(req.params.novelId)
  );
});

chatsRouter.post('/novel/:novelId', (req, res) => {
  const { title = 'New Chat' } = req.body ?? {};
  const result = db
    .prepare('INSERT INTO chats (novel_id, title) VALUES (?, ?)')
    .run(req.params.novelId, String(title));
  res.json(db.prepare('SELECT * FROM chats WHERE id = ?').get(result.lastInsertRowid));
});

chatsRouter.get('/:id/messages', (req, res) => {
  res.json(
    db
      .prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id')
      .all(req.params.id)
  );
});

chatsRouter.put('/:id', (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title === 'string') {
    db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, req.params.id);
  }
  res.json(db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id));
});

chatsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM chats WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
