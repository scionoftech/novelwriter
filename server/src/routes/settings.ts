import { Router } from 'express';
import { setSetting } from '../db';
import { DEFAULT_AI_SETTINGS, getAISettings, AISettings } from '../ai/providers';
import { DEFAULT_PROMPTS, getPrompts } from '../ai/prompts';
import { getSyncSettings, SyncSettings } from '../sync/vault';

export const settingsRouter = Router();

const MASK = '••••••••';

function maskSecret(value: string): string {
  if (!value) return '';
  return MASK + value.slice(-4);
}

settingsRouter.get('/', (_req, res) => {
  const ai = getAISettings();
  res.json({
    ai: {
      ...ai,
      anthropic: { apiKey: maskSecret(ai.anthropic.apiKey) },
      bedrock: { ...ai.bedrock, secretAccessKey: maskSecret(ai.bedrock.secretAccessKey) },
    },
    anthropicEnvKey: Boolean(process.env.ANTHROPIC_API_KEY),
    sync: getSyncSettings(),
    prompts: getPrompts(),
    defaultPrompts: DEFAULT_PROMPTS,
  });
});

settingsRouter.put('/', (req, res) => {
  const body = req.body ?? {};
  if (body.ai) {
    const current = getAISettings();
    const incoming = body.ai as Partial<AISettings>;
    const keepIfMasked = (incomingValue: string | undefined, currentValue: string) =>
      incomingValue === undefined || incomingValue.startsWith(MASK) ? currentValue : incomingValue;
    const merged: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      ...current,
      ...incoming,
      anthropic: { apiKey: keepIfMasked(incoming.anthropic?.apiKey, current.anthropic.apiKey) },
      bedrock: {
        ...current.bedrock,
        ...incoming.bedrock,
        secretAccessKey: keepIfMasked(incoming.bedrock?.secretAccessKey, current.bedrock.secretAccessKey),
      },
      ollama: { ...current.ollama, ...incoming.ollama },
      maxTokens: Math.max(256, Math.min(64000, Number(incoming.maxTokens ?? current.maxTokens) || 4000)),
      contextScenes: Math.max(0, Math.min(10, Number(incoming.contextScenes ?? current.contextScenes) || 0)),
    };
    setSetting('ai', merged);
  }
  if (body.sync && typeof body.sync === 'object') {
    const incoming = body.sync as Partial<SyncSettings>;
    setSetting('sync', {
      enabled: Boolean(incoming.enabled),
      vaultPath: typeof incoming.vaultPath === 'string' ? incoming.vaultPath.trim() : '',
    });
  }
  if (body.prompts && typeof body.prompts === 'object') {
    const overrides: Record<string, string> = {};
    for (const key of Object.keys(DEFAULT_PROMPTS) as (keyof typeof DEFAULT_PROMPTS)[]) {
      const v = (body.prompts as Record<string, unknown>)[key];
      // Only store overrides that differ from the default
      if (typeof v === 'string' && v.trim() && v !== DEFAULT_PROMPTS[key]) overrides[key] = v;
    }
    setSetting('prompts', overrides);
  }
  res.json({ ok: true });
});
