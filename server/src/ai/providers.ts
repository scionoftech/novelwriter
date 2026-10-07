import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { getSetting } from '../db';

export type ProviderId = 'anthropic' | 'bedrock' | 'ollama';

export interface AISettings {
  provider: ProviderId;
  model: string;
  maxTokens: number;
  contextScenes: number;
  anthropic: { apiKey: string };
  bedrock: { region: string; accessKeyId: string; secretAccessKey: string };
  ollama: { baseUrl: string };
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  maxTokens: 4000,
  contextScenes: 2,
  anthropic: { apiKey: '' },
  bedrock: { region: 'us-east-1', accessKeyId: '', secretAccessKey: '' },
  ollama: { baseUrl: 'http://localhost:11434' },
};

export function getAISettings(): AISettings {
  const stored = getSetting<Partial<AISettings>>('ai', {});
  return {
    ...DEFAULT_AI_SETTINGS,
    ...stored,
    anthropic: { ...DEFAULT_AI_SETTINGS.anthropic, ...stored.anthropic },
    bedrock: { ...DEFAULT_AI_SETTINGS.bedrock, ...stored.bedrock },
    ollama: { ...DEFAULT_AI_SETTINGS.ollama, ...stored.ollama },
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamParams {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal: AbortSignal;
  onText: (text: string) => void;
  /** Optional overrides; defaults come from settings. */
  provider?: ProviderId;
  model?: string;
}

/**
 * Adaptive thinking is only accepted by Opus 4.6+, Sonnet 4.6+, and the Fable/Mythos
 * models. Haiku 4.5 instead takes an explicit token budget. Anything older or unknown
 * gets no `thinking` parameter at all, which runs without thinking and is accepted
 * everywhere.
 */
const ADAPTIVE_THINKING_RE =
  /claude-(?:opus-(?:4-[6-9](?!\d)|[5-9])|sonnet-(?:4-[6-9](?!\d)|[5-9])|fable-|mythos-)/;
const BUDGET_THINKING_RE = /claude-haiku-4-5(?!\d)/;

export function supportsAdaptiveThinking(model: string): boolean {
  return ADAPTIVE_THINKING_RE.test(model);
}

export function supportsBudgetThinking(model: string): boolean {
  return BUDGET_THINKING_RE.test(model);
}

/** Thinking tokens are drawn from max_tokens, so leave room for them on top of the prose cap. */
const THINKING_HEADROOM_TOKENS = 6000;
/** Haiku's thinking budget: at least 1024 and below max_tokens, which the headroom guarantees. */
const HAIKU_THINKING_BUDGET = 4000;

function thinkingOptions(model: string, maxTokens: number) {
  if (supportsAdaptiveThinking(model)) {
    return { max_tokens: maxTokens + THINKING_HEADROOM_TOKENS, thinking: { type: 'adaptive' as const } };
  }
  if (supportsBudgetThinking(model)) {
    return {
      max_tokens: maxTokens + HAIKU_THINKING_BUDGET,
      thinking: { type: 'enabled' as const, budget_tokens: HAIKU_THINKING_BUDGET },
    };
  }
  return { max_tokens: maxTokens };
}

function anthropicApiKey(settings: AISettings): string {
  return settings.anthropic.apiKey || process.env.ANTHROPIC_API_KEY || '';
}

async function streamAnthropic(params: StreamParams, settings: AISettings, model: string): Promise<string> {
  const apiKey = anthropicApiKey(settings);
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  const stream = client.messages.stream(
    {
      model,
      ...thinkingOptions(model, params.maxTokens),
      system: params.system,
      messages: params.messages,
    },
    { signal: params.signal }
  );
  stream.on('text', (delta) => params.onText(delta));
  const final = await stream.finalMessage();
  return final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

async function streamBedrock(params: StreamParams, settings: AISettings, model: string): Promise<string> {
  // The Bedrock Mantle client reads AWS credentials from the environment /
  // standard AWS credential chain. If keys were entered in Settings, expose
  // them via env before constructing the client.
  if (settings.bedrock.accessKeyId && settings.bedrock.secretAccessKey) {
    process.env.AWS_ACCESS_KEY_ID = settings.bedrock.accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = settings.bedrock.secretAccessKey;
  }
  const client = new AnthropicBedrockMantle({
    awsRegion: settings.bedrock.region || 'us-east-1',
  });
  // Bedrock model IDs take an `anthropic.` prefix.
  const bedrockModel = model.startsWith('anthropic.') ? model : `anthropic.${model}`;
  const stream = client.messages.stream(
    {
      model: bedrockModel,
      ...thinkingOptions(bedrockModel, params.maxTokens),
      system: params.system,
      messages: params.messages,
    },
    { signal: params.signal }
  );
  stream.on('text', (delta: string) => params.onText(delta));
  const final = await stream.finalMessage();
  return final.content
    .filter((b: { type: string }): b is Anthropic.TextBlock => b.type === 'text')
    .map((b: Anthropic.TextBlock) => b.text)
    .join('');
}

async function streamOllama(params: StreamParams, settings: AISettings, model: string): Promise<string> {
  const base = (settings.ollama.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: params.signal,
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: params.system },
        ...params.messages,
      ],
      options: { num_predict: params.maxTokens },
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  let full = '';
  let buffer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const delta: string = obj?.message?.content ?? '';
        if (delta) {
          full += delta;
          params.onText(delta);
        }
        if (obj?.error) throw new Error(String(obj.error));
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return full;
}

/** Stream a completion from the configured (or overridden) provider. Returns the full text. */
export async function streamCompletion(params: StreamParams): Promise<string> {
  const settings = getAISettings();
  const provider = params.provider || settings.provider;
  const model = params.model || settings.model;
  switch (provider) {
    case 'anthropic':
      return streamAnthropic(params, settings, model);
    case 'bedrock':
      return streamBedrock(params, settings, model);
    case 'ollama':
      return streamOllama(params, settings, model);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

const FALLBACK_ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
];

export async function listModels(provider: ProviderId): Promise<{ id: string; name: string }[]> {
  const settings = getAISettings();
  if (provider === 'anthropic') {
    try {
      const apiKey = anthropicApiKey(settings);
      const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
      const models: { id: string; name: string }[] = [];
      for await (const m of client.models.list()) {
        models.push({ id: m.id, name: m.display_name || m.id });
      }
      return models.length ? models : FALLBACK_ANTHROPIC_MODELS;
    } catch {
      return FALLBACK_ANTHROPIC_MODELS;
    }
  }
  if (provider === 'bedrock') {
    return FALLBACK_ANTHROPIC_MODELS.map((m) => ({
      id: `anthropic.${m.id}`,
      name: `${m.name} (Bedrock)`,
    }));
  }
  // ollama
  try {
    const base = (settings.ollama.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => ({ id: m.name, name: m.name }));
  } catch {
    return [];
  }
}
