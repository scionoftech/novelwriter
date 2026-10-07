export interface Novel {
  id: number;
  title: string;
  author: string;
  description: string;
  created_at: string;
  updated_at: string;
  word_count?: number;
  chapter_count?: number;
}

export interface SceneMeta {
  id: number;
  chapter_id: number;
  title: string;
  summary: string;
  status: string;
  pov: string;
  sort_order: number;
  word_count: number;
  updated_at: string;
}

export interface Scene extends SceneMeta {
  content: string;
  created_at: string;
}

export interface Chapter {
  id: number;
  novel_id: number;
  title: string;
  sort_order: number;
  scenes: SceneMeta[];
}

export type CodexType = 'character' | 'location' | 'item' | 'lore' | 'other';

export interface CodexEntry {
  id: number;
  novel_id: number;
  type: CodexType;
  name: string;
  aliases: string; // JSON array string
  description: string;
  always_include: number;
}

export interface Snapshot {
  id: number;
  scene_id: number;
  label: string;
  word_count: number;
  created_at: string;
  content?: string;
}

export interface Chat {
  id: number;
  novel_id: number;
  title: string;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  chat_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

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

export interface PromptTemplates {
  system: string;
  chatSystem: string;
  continue: string;
  rewrite: string;
  expand: string;
  shorten: string;
  improve: string;
  summarize: string;
}

export interface SyncSettings {
  enabled: boolean;
  vaultPath: string;
}

export interface SettingsPayload {
  ai: AISettings;
  anthropicEnvKey: boolean;
  sync: SyncSettings;
  prompts: PromptTemplates;
  defaultPrompts: PromptTemplates;
}

export type AIAction = 'continue' | 'rewrite' | 'expand' | 'shorten' | 'improve' | 'summarize' | 'chat';

export const SCENE_STATUSES = ['outline', 'draft', 'revised', 'done'] as const;

export const STATUS_COLORS: Record<string, string> = {
  outline: 'bg-ink-600',
  draft: 'bg-sky-700',
  revised: 'bg-violet-700',
  done: 'bg-emerald-700',
};
