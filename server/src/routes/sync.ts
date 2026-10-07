import { Router } from 'express';
import { syncNovelToVault } from '../sync/vault';

export const syncRouter = Router();

syncRouter.post('/:novelId', (req, res) => {
  try {
    const result = syncNovelToVault(Number(req.params.novelId));
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
