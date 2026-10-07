import { useState, useEffect } from 'react';
import ChapterSidebar from '../components/ChapterSidebar';
import SceneEditor from '../components/SceneEditor';
import AIPanel from '../components/AIPanel';
import { useNovelStore } from '../store';
import type { EditorBridge } from '../lib/editorBridge';

export default function Write() {
  const [bridge, setBridge] = useState<EditorBridge | null>(null);
  const { focusMode, setFocusMode, chapters, currentScene, openScene } = useNovelStore();

  // Auto-open the first scene so the editor is ready immediately
  useEffect(() => {
    if (currentScene) return;
    const first = chapters.flatMap((c) => c.scenes)[0];
    if (first) openScene(first.id).catch(console.error);
  }, [chapters, currentScene, openScene]);

  return (
    <div className="h-full flex">
      {!focusMode && <ChapterSidebar />}
      <SceneEditor onBridgeReady={setBridge} />
      {!focusMode && <AIPanel bridge={bridge} />}
      {focusMode && (
        <button
          className="fixed top-3 right-3 btn-secondary text-xs opacity-40 hover:opacity-100"
          onClick={() => setFocusMode(false)}
        >
          ⤡ Exit focus
        </button>
      )}
    </div>
  );
}
