import type {
  Novel,
  Chapter,
  Scene,
  CodexEntry,
  Snapshot,
  Chat,
  ChatMessage,
  SettingsPayload,
  AIAction,
  ProviderId,
} from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  // novels
  listNovels: () => get<Novel[]>('/novels'),
  createNovel: (data: { title: string; author?: string; description?: string }) =>
    post<Novel>('/novels', data),
  getNovel: (id: number) => get<Novel>(`/novels/${id}`),
  updateNovel: (id: number, data: Partial<Novel>) => put<Novel>(`/novels/${id}`, data),
  deleteNovel: (id: number) => del<{ ok: true }>(`/novels/${id}`),
  getTree: (novelId: number) => get<Chapter[]>(`/novels/${novelId}/tree`),

  // chapters
  createChapter: (novelId: number, title?: string) =>
    post<Chapter>(`/novels/${novelId}/chapters`, { title }),
  updateChapter: (chapterId: number, title: string) =>
    put<Chapter>(`/novels/chapters/${chapterId}`, { title }),
  deleteChapter: (chapterId: number) => del<{ ok: true }>(`/novels/chapters/${chapterId}`),
  reorderChapters: (novelId: number, orderedIds: number[]) =>
    put<{ ok: true }>(`/novels/${novelId}/chapters/reorder`, { orderedIds }),

  // scenes
  createScene: (chapterId: number, title?: string) =>
    post<Scene>(`/novels/chapters/${chapterId}/scenes`, { title }),
  getScene: (sceneId: number) => get<Scene>(`/novels/scenes/${sceneId}`),
  updateScene: (sceneId: number, data: Partial<Scene>) =>
    put<Scene>(`/novels/scenes/${sceneId}`, data),
  deleteScene: (sceneId: number) => del<{ ok: true }>(`/novels/scenes/${sceneId}`),
  reorderScenes: (chapterId: number, orderedIds: number[]) =>
    put<{ ok: true }>(`/novels/chapters/${chapterId}/scenes/reorder`, { orderedIds }),

  // codex
  listCodex: (novelId: number) => get<CodexEntry[]>(`/codex/novel/${novelId}`),
  createCodex: (novelId: number, data: Partial<CodexEntry> & { aliases?: string[] }) =>
    post<CodexEntry>(`/codex/novel/${novelId}`, data),
  updateCodex: (id: number, data: Partial<Omit<CodexEntry, 'aliases'>> & { aliases?: string[] }) =>
    put<CodexEntry>(`/codex/${id}`, data),
  deleteCodex: (id: number) => del<{ ok: true }>(`/codex/${id}`),

  // snapshots
  listSnapshots: (sceneId: number) => get<Snapshot[]>(`/snapshots/scene/${sceneId}`),
  createSnapshot: (sceneId: number, label?: string) =>
    post<Snapshot>(`/snapshots/scene/${sceneId}`, { label }),
  getSnapshot: (id: number) => get<Snapshot>(`/snapshots/${id}`),
  restoreSnapshot: (id: number) => post<Scene>(`/snapshots/${id}/restore`),
  deleteSnapshot: (id: number) => del<{ ok: true }>(`/snapshots/${id}`),

  // chats
  listChats: (novelId: number) => get<Chat[]>(`/chats/novel/${novelId}`),
  createChat: (novelId: number, title?: string) => post<Chat>(`/chats/novel/${novelId}`, { title }),
  getChatMessages: (chatId: number) => get<ChatMessage[]>(`/chats/${chatId}/messages`),
  renameChat: (chatId: number, title: string) => put<Chat>(`/chats/${chatId}`, { title }),
  deleteChat: (chatId: number) => del<{ ok: true }>(`/chats/${chatId}`),

  // settings
  getSettings: () => get<SettingsPayload>('/settings'),
  saveSettings: (data: { ai?: unknown; sync?: unknown; prompts?: unknown }) =>
    put<{ ok: true }>('/settings', data),

  // obsidian vault sync
  syncNovel: (novelId: number) => post<{ files: number; dir: string }>(`/sync/${novelId}`),

  // ai
  listModels: (provider: ProviderId) =>
    get<{ id: string; name: string }[]>(`/ai/models?provider=${provider}`),

  exportUrl: (novelId: number, format: 'markdown' | 'text' | 'docx') =>
    `/api/export/${novelId}?format=${format}`,
};

export interface ImportPreview {
  title: string;
  author: string;
  totalWords: number;
  chapters: { title: string; sceneCount: number; words: number; sceneTitles: string[] }[];
}

export interface ImportResult {
  novelId: number;
  title: string;
  chapterCount: number;
  sceneCount: number;
  totalWords: number;
}

export async function importManuscript(
  file: File,
  opts: { dryRun: boolean; novelId?: number; title?: string }
): Promise<ImportPreview & ImportResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('dryRun', String(opts.dryRun));
  if (opts.novelId) form.append('novelId', String(opts.novelId));
  if (opts.title) form.append('title', opts.title);
  const res = await fetch('/api/import', { method: 'POST', body: form });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

export interface GenerateRequest {
  action: AIAction;
  novelId: number;
  sceneId?: number | null;
  selection?: string;
  instruction?: string;
  chatId?: number;
  message?: string;
}

/** Stream an AI generation over SSE-in-fetch. Returns the full text. */
export async function streamGenerate(
  body: GenerateRequest,
  onText: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const err = await res.json();
      if (err?.error) message = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let obj: { type: string; text?: string; message?: string };
      try {
        obj = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (obj.type === 'text' && obj.text) {
        full += obj.text;
        onText(obj.text);
      } else if (obj.type === 'error') {
        throw new Error(obj.message || 'AI generation failed');
      } else if (obj.type === 'done' && typeof obj.text === 'string') {
        full = obj.text;
      }
    }
  }
  return full;
}
