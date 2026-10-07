import { Router, Response } from 'express';
import { db, transaction } from '../db';
import { streamCompletion, listModels, getAISettings, ProviderId, ChatMessage } from '../ai/providers';
import { getPrompts } from '../ai/prompts';
import { buildSceneContext } from '../ai/context';

export const aiRouter = Router();

type Action = 'continue' | 'rewrite' | 'expand' | 'shorten' | 'improve' | 'summarize' | 'chat';

interface GenerateBody {
  action: Action;
  novelId: number;
  sceneId?: number | null;
  selection?: string;
  instruction?: string;
  chatId?: number;
  message?: string;
}

function sse(res: Response, obj: unknown): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

aiRouter.get('/models', async (req, res) => {
  const provider = String(req.query.provider || 'anthropic') as ProviderId;
  res.json(await listModels(provider));
});

aiRouter.post('/generate', async (req, res) => {
  const body = req.body as GenerateBody;
  const prompts = getPrompts();
  const settings = getAISettings();

  let system: string;
  let messages: ChatMessage[];
  let saveAssistantToChat: number | null = null;
  let pendingUserMessage = '';

  try {
    if (!body || !body.action || !body.novelId) {
      return res.status(400).json({ error: 'action and novelId are required' });
    }
    const searchExtra = [body.selection, body.instruction, body.message].filter(Boolean).join('\n');
    const ctx = buildSceneContext(body.novelId, body.sceneId ?? null, searchExtra);

    if (body.action === 'chat') {
      if (!body.chatId || !body.message) {
        return res.status(400).json({ error: 'chatId and message are required for chat' });
      }
      const chat = db
        .prepare('SELECT id FROM chats WHERE id = ? AND novel_id = ?')
        .get(body.chatId, body.novelId);
      if (!chat) return res.status(404).json({ error: 'chat not found' });
      const history = db
        .prepare('SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY id')
        .all(body.chatId) as unknown as ChatMessage[];
      // Saved together with the reply once it succeeds, so a failed or aborted
      // request leaves no orphaned user message behind.
      pendingUserMessage = body.message;
      saveAssistantToChat = body.chatId;
      system = `${prompts.chatSystem}\n\n=== STORY CONTEXT ===\n\n${ctx.contextBlock}`;
      messages = [...history, { role: 'user', content: body.message }];
    } else {
      system = `${prompts.system}\n\n=== STORY CONTEXT ===\n\n${ctx.contextBlock}`;
      const instruction = body.instruction?.trim();
      let userMsg: string;
      switch (body.action) {
        case 'continue':
          userMsg = prompts.continue + (instruction ? `\n\nGuidance from the author: ${instruction}` : '');
          break;
        case 'rewrite':
        case 'expand':
        case 'shorten':
        case 'improve': {
          if (!body.selection?.trim()) {
            return res.status(400).json({ error: 'selection is required for this action' });
          }
          const base = prompts[body.action];
          userMsg =
            base +
            (instruction ? `\n\nAuthor's instruction: ${instruction}` : '') +
            `\n\nPASSAGE:\n${body.selection}`;
          break;
        }
        case 'summarize':
          userMsg = prompts.summarize;
          break;
        default:
          return res.status(400).json({ error: `unknown action: ${String(body.action)}` });
      }
      messages = [{ role: 'user', content: userMsg }];
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const abort = new AbortController();
  // res 'close' fires when the client disconnects; req 'close' would fire as
  // soon as the request body is consumed, which would abort immediately.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const full = await streamCompletion({
      system,
      messages,
      maxTokens: settings.maxTokens,
      signal: abort.signal,
      onText: (text) => sse(res, { type: 'text', text }),
    });
    if (saveAssistantToChat != null && full.trim()) {
      const chatId = saveAssistantToChat;
      const insert = db.prepare('INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)');
      transaction(() => {
        insert.run(chatId, 'user', pendingUserMessage);
        insert.run(chatId, 'assistant', full);
      });
    }
    sse(res, { type: 'done', text: full });
  } catch (e) {
    if (!abort.signal.aborted) {
      const message = e instanceof Error ? e.message : String(e);
      sse(res, { type: 'error', message });
    }
  }
  res.end();
});
