import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useNovelStore } from '../store';
import { SCENE_STATUSES, STATUS_COLORS } from '../types';

export default function Plan() {
  const { novel, chapters, refreshTree, openScene, saveScene } = useNovelStore();
  const navigate = useNavigate();

  if (!novel) return null;

  const updateSceneMeta = async (sceneId: number, data: Record<string, string>) => {
    // via the store so the scene open in the editor picks up the change too
    await saveScene(sceneId, data);
  };

  const goWrite = async (sceneId: number) => {
    await openScene(sceneId);
    navigate(`/novel/${novel.id}/write`);
  };

  return (
    <div className="h-full overflow-x-auto overflow-y-hidden">
      <div className="h-full flex gap-4 p-6 min-w-max">
        {chapters.map((chapter) => (
          <div key={chapter.id} className="w-72 shrink-0 flex flex-col card">
            <div className="p-3 border-b border-ink-800 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-ink-100 truncate">{chapter.title}</h3>
              <span className="text-xs text-ink-500">
                {chapter.scenes.reduce((s, sc) => s + sc.word_count, 0).toLocaleString()} w
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {chapter.scenes.map((scene) => (
                <div key={scene.id} className="rounded-md bg-ink-850 border border-ink-800 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      className="flex-1 text-left text-sm font-medium text-ink-100 truncate hover:text-accent-400"
                      onClick={() => goWrite(scene.id)}
                      title="Open in editor"
                    >
                      {scene.title}
                    </button>
                    <select
                      className={`text-[10px] rounded px-1.5 py-0.5 text-white border-0 ${STATUS_COLORS[scene.status] ?? 'bg-ink-600'}`}
                      value={scene.status}
                      onChange={(e) => updateSceneMeta(scene.id, { status: e.target.value })}
                    >
                      {SCENE_STATUSES.map((s) => (
                        <option key={s} value={s} className="bg-ink-800">{s}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    className="w-full bg-transparent text-xs text-ink-300 placeholder-ink-600 resize-none focus:outline-none min-h-14"
                    placeholder="Scene summary… (feeds AI context)"
                    defaultValue={scene.summary}
                    key={`${scene.id}-${scene.summary}`}
                    onBlur={(e) => {
                      if (e.target.value !== scene.summary) {
                        updateSceneMeta(scene.id, { summary: e.target.value });
                      }
                    }}
                  />
                  <p className="text-[10px] text-ink-500 mt-1">
                    {scene.word_count.toLocaleString()} words{scene.pov ? ` · POV ${scene.pov}` : ''}
                  </p>
                </div>
              ))}
              <button
                className="w-full btn-ghost text-xs justify-center border border-dashed border-ink-700"
                onClick={async () => {
                  await api.createScene(chapter.id);
                  await refreshTree();
                }}
              >
                + Scene
              </button>
            </div>
          </div>
        ))}
        <button
          className="w-72 shrink-0 card border-dashed text-ink-500 hover:text-ink-300 hover:border-ink-600 text-sm"
          onClick={async () => {
            await api.createChapter(novel.id, `Chapter ${chapters.length + 1}`);
            await refreshTree();
          }}
        >
          + New chapter
        </button>
      </div>
    </div>
  );
}
