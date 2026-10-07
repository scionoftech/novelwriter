import { create } from 'zustand';
import { api } from './api';
import type { Novel, Chapter, Scene, CodexEntry } from './types';

interface NovelState {
  novel: Novel | null;
  chapters: Chapter[];
  codex: CodexEntry[];
  currentScene: Scene | null;
  focusMode: boolean;
  saving: boolean;
  /** Bumped when scene content changes outside the editor (e.g. snapshot restore). */
  reloadKey: number;
  bumpReload: () => void;

  loadNovel: (novelId: number) => Promise<void>;
  refreshTree: () => Promise<void>;
  refreshCodex: () => Promise<void>;
  openScene: (sceneId: number) => Promise<void>;
  closeScene: () => void;
  saveScene: (sceneId: number, data: Partial<Scene>) => Promise<Scene | null>;
  setFocusMode: (on: boolean) => void;
}

let loadSeq = 0;

export const useNovelStore = create<NovelState>((set, get) => ({
  novel: null,
  chapters: [],
  codex: [],
  currentScene: null,
  focusMode: false,
  saving: false,
  reloadKey: 0,
  bumpReload: () => set((s) => ({ reloadKey: s.reloadKey + 1 })),

  loadNovel: async (novelId) => {
    const seq = ++loadSeq;
    // Don't show (or open scenes from) the previously open novel while this one loads.
    if (get().novel?.id !== novelId) set({ novel: null, chapters: [], codex: [], currentScene: null });
    const [novel, chapters, codex] = await Promise.all([
      api.getNovel(novelId),
      api.getTree(novelId),
      api.listCodex(novelId),
    ]);
    if (seq !== loadSeq) return; // a newer load superseded this one
    set({ novel, chapters, codex });
    // keep the current scene only if it belongs to this novel
    const scene = get().currentScene;
    if (scene && !chapters.some((c) => c.scenes.some((s) => s.id === scene.id))) {
      set({ currentScene: null });
    }
  },

  refreshTree: async () => {
    const novel = get().novel;
    if (!novel) return;
    set({ chapters: await api.getTree(novel.id) });
  },

  refreshCodex: async () => {
    const novel = get().novel;
    if (!novel) return;
    set({ codex: await api.listCodex(novel.id) });
  },

  openScene: async (sceneId) => {
    const scene = await api.getScene(sceneId);
    set({ currentScene: scene });
  },

  closeScene: () => set({ currentScene: null }),

  saveScene: async (sceneId, data) => {
    set({ saving: true });
    try {
      const updated = await api.updateScene(sceneId, data);
      const { currentScene, chapters } = get();
      set({
        // Merge only what this save sent (plus server-derived fields). Merging the whole
        // response would clobber in-progress edits to other fields, e.g. a title being typed
        // while a content autosave returns.
        currentScene:
          currentScene?.id === sceneId
            ? {
                ...currentScene,
                ...(Object.fromEntries(Object.keys(data).map((k) => [k, updated[k as keyof Scene]])) as Partial<Scene>),
                word_count: updated.word_count,
                updated_at: updated.updated_at,
              }
            : currentScene,
        chapters: chapters.map((c) => ({
          ...c,
          scenes: c.scenes.map((s) =>
            s.id === sceneId
              ? {
                  ...s,
                  title: updated.title,
                  summary: updated.summary,
                  status: updated.status,
                  pov: updated.pov,
                  word_count: updated.word_count,
                }
              : s
          ),
        })),
      });
      return updated;
    } finally {
      set({ saving: false });
    }
  },

  setFocusMode: (on) => set({ focusMode: on }),
}));
