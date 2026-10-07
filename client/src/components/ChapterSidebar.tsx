import { useState } from 'react';
import { api } from '../api';
import { useNovelStore } from '../store';
import { STATUS_COLORS } from '../types';
import type { Chapter } from '../types';

export default function ChapterSidebar() {
  const { novel, chapters, currentScene, refreshTree, openScene, closeScene } = useNovelStore();
  const [editingChapter, setEditingChapter] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  if (!novel) return null;

  const addChapter = async () => {
    await api.createChapter(novel.id, `Chapter ${chapters.length + 1}`);
    await refreshTree();
  };

  const addScene = async (chapterId: number) => {
    const scene = await api.createScene(chapterId);
    await refreshTree();
    await openScene(scene.id);
  };

  const renameChapter = async (chapterId: number) => {
    if (draftTitle.trim()) await api.updateChapter(chapterId, draftTitle.trim());
    setEditingChapter(null);
    await refreshTree();
  };

  const deleteChapter = async (chapter: Chapter) => {
    if (!confirm(`Delete "${chapter.title}" and its ${chapter.scenes.length} scene(s)?`)) return;
    if (currentScene && chapter.scenes.some((s) => s.id === currentScene.id)) closeScene();
    await api.deleteChapter(chapter.id);
    await refreshTree();
  };

  const deleteScene = async (sceneId: number, title: string) => {
    if (!confirm(`Delete scene "${title}"?`)) return;
    if (currentScene?.id === sceneId) closeScene();
    await api.deleteScene(sceneId);
    await refreshTree();
  };

  const moveChapter = async (index: number, dir: -1 | 1) => {
    const ids = chapters.map((c) => c.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await api.reorderChapters(novel.id, ids);
    await refreshTree();
  };

  const moveScene = async (chapter: Chapter, index: number, dir: -1 | 1) => {
    const ids = chapter.scenes.map((s) => s.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await api.reorderScenes(chapter.id, ids);
    await refreshTree();
  };

  return (
    <aside className="w-72 shrink-0 border-r border-ink-800 overflow-y-auto flex flex-col">
      <div className="p-3 flex items-center justify-between border-b border-ink-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">Manuscript</span>
        <button className="btn-ghost px-2 py-0.5 text-xs" onClick={addChapter}>+ Chapter</button>
      </div>
      <div className="flex-1 py-2">
        {chapters.map((chapter, ci) => (
          <div key={chapter.id} className="mb-1">
            <div className="group flex items-center gap-1 px-3 py-1.5">
              {editingChapter === chapter.id ? (
                <input
                  className="input py-0.5 text-sm"
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={() => renameChapter(chapter.id)}
                  onKeyDown={(e) => e.key === 'Enter' && renameChapter(chapter.id)}
                />
              ) : (
                <>
                  <button
                    className="flex-1 text-left text-sm font-semibold text-ink-200 truncate"
                    onDoubleClick={() => {
                      setEditingChapter(chapter.id);
                      setDraftTitle(chapter.title);
                    }}
                    title="Double-click to rename"
                  >
                    {chapter.title}
                  </button>
                  <span className="hidden group-hover:flex items-center gap-0.5 text-ink-500">
                    <button className="hover:text-ink-200 px-0.5" title="Move up" onClick={() => moveChapter(ci, -1)}>↑</button>
                    <button className="hover:text-ink-200 px-0.5" title="Move down" onClick={() => moveChapter(ci, 1)}>↓</button>
                    <button className="hover:text-ink-200 px-0.5" title="Add scene" onClick={() => addScene(chapter.id)}>+</button>
                    <button className="hover:text-red-400 px-0.5" title="Delete chapter" onClick={() => deleteChapter(chapter)}>✕</button>
                  </span>
                </>
              )}
            </div>
            {chapter.scenes.map((scene, si) => (
              <div
                key={scene.id}
                className={`group flex items-center gap-2 pl-6 pr-3 py-1.5 cursor-pointer text-sm ${
                  currentScene?.id === scene.id
                    ? 'bg-ink-800 text-ink-100'
                    : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100'
                }`}
                onClick={() => openScene(scene.id)}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[scene.status] ?? 'bg-ink-600'}`} title={scene.status} />
                <span className="flex-1 truncate">{scene.title}</span>
                <span className="text-[10px] text-ink-500 group-hover:hidden">{scene.word_count}</span>
                <span
                  className="hidden group-hover:flex items-center gap-0.5 text-ink-500"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="hover:text-ink-200 px-0.5" title="Move up" onClick={() => moveScene(chapter, si, -1)}>↑</button>
                  <button className="hover:text-ink-200 px-0.5" title="Move down" onClick={() => moveScene(chapter, si, 1)}>↓</button>
                  <button className="hover:text-red-400 px-0.5" title="Delete scene" onClick={() => deleteScene(scene.id, scene.title)}>✕</button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
