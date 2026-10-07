import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Focus from '@tiptap/extension-focus';
import { useNovelStore } from '../store';
import { SCENE_STATUSES } from '../types';
import { htmlToMarkdown, markdownToHtml, countMdWords } from '../lib/markdown';
import type { EditorBridge } from '../lib/editorBridge';
import SnapshotsModal from './SnapshotsModal';

type EditorMode = 'rich' | 'md';

interface Props {
  onBridgeReady: (bridge: EditorBridge | null) => void;
}

export default function SceneEditor({ onBridgeReady }: Props) {
  const { currentScene, saveScene, saving, focusMode, setFocusMode, reloadKey } = useNovelStore();
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [mode, setMode] = useState<EditorMode>(
    () => (localStorage.getItem('nw-editor-mode') as EditorMode) || 'rich'
  );
  const [mdText, setMdText] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  /** True while an edit is waiting on the autosave debounce. */
  const dirtyRef = useRef(false);
  const sceneIdRef = useRef<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef(mode);
  const mdTextRef = useRef(mdText);
  modeRef.current = mode;
  mdTextRef.current = mdText;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Begin your scene…' }),
      CharacterCount,
      Focus.configure({ className: 'current-line', mode: 'shallowest' }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (modeRef.current !== 'rich') return;
      const sceneId = sceneIdRef.current;
      if (sceneId == null) return;
      clearTimeout(saveTimer.current);
      dirtyRef.current = true;
      saveTimer.current = setTimeout(() => {
        dirtyRef.current = false;
        saveScene(sceneId, { content: editor.getHTML() }).catch(console.error);
      }, 800);
    },
  });

  const autoGrow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  const scheduleMdSave = useCallback(
    (text: string) => {
      const sceneId = sceneIdRef.current;
      if (sceneId == null) return;
      clearTimeout(saveTimer.current);
      dirtyRef.current = true;
      saveTimer.current = setTimeout(() => {
        dirtyRef.current = false;
        saveScene(sceneId, { content: markdownToHtml(text) }).catch(console.error);
      }, 800);
    },
    [saveScene]
  );

  // Load scene content into the active editor when the open scene changes,
  // or when content changed outside the editor (snapshot restore → reloadKey).
  const lastReloadRef = useRef(reloadKey);
  useEffect(() => {
    if (!currentScene) return;
    if (sceneIdRef.current === currentScene.id && lastReloadRef.current === reloadKey) return;
    clearTimeout(saveTimer.current);
    // Switching scenes: flush an edit still waiting on the debounce, or it is lost.
    // (A reload of the same scene, e.g. snapshot restore, intentionally discards it.)
    const prevId = sceneIdRef.current;
    if (dirtyRef.current && prevId != null && prevId !== currentScene.id) {
      const content =
        modeRef.current === 'md' ? markdownToHtml(mdTextRef.current) : editor?.getHTML();
      if (content !== undefined) saveScene(prevId, { content }).catch(console.error);
    }
    dirtyRef.current = false;
    sceneIdRef.current = currentScene.id;
    lastReloadRef.current = reloadKey;
    editor?.commands.setContent(currentScene.content || '', false);
    setMdText(htmlToMarkdown(currentScene.content || ''));
    requestAnimationFrame(autoGrow);
  }, [editor, currentScene, autoGrow, reloadKey]);

  useEffect(() => {
    if (mode === 'md') requestAnimationFrame(autoGrow);
  }, [mode, autoGrow]);

  // Flush pending save on unmount (mode-aware)
  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
      const sceneId = sceneIdRef.current;
      if (sceneId == null) return;
      const content =
        modeRef.current === 'md' ? markdownToHtml(mdTextRef.current) : editor?.getHTML();
      if (content !== undefined) saveScene(sceneId, { content }).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMode = () => {
    clearTimeout(saveTimer.current);
    const sceneId = sceneIdRef.current;
    if (mode === 'rich') {
      const html = editor?.getHTML() ?? '';
      setMdText(htmlToMarkdown(html));
      setMode('md');
      localStorage.setItem('nw-editor-mode', 'md');
      requestAnimationFrame(autoGrow);
    } else {
      const html = markdownToHtml(mdText);
      editor?.commands.setContent(html, false);
      if (sceneId != null) saveScene(sceneId, { content: html }).catch(console.error);
      setMode('rich');
      localStorage.setItem('nw-editor-mode', 'rich');
    }
  };

  // Expose a mode-agnostic bridge for the AI panel
  useEffect(() => {
    if (!currentScene) {
      onBridgeReady(null);
      return;
    }
    const persist = (content: string) =>
      saveScene(currentScene.id, { content }).then(() => undefined);

    const bridge: EditorBridge =
      mode === 'rich' && editor
        ? {
            getSelectionText: () => {
              const { from, to } = editor.state.selection;
              return editor.state.doc.textBetween(from, to, '\n\n');
            },
            captureSelection: () => {
              const { from, to } = editor.state.selection;
              return { from, to };
            },
            replaceRange: async (range, text) => {
              const { from, to } = range as { from: number; to: number };
              editor.chain().focus().insertContentAt({ from, to }, markdownToHtml(text)).run();
              await persist(editor.getHTML());
            },
            appendToEnd: async (text) => {
              editor.chain().focus('end').insertContent(markdownToHtml(text)).run();
              await persist(editor.getHTML());
            },
            captureBlock: () => {
              const { $from } = editor.state.selection;
              if ($from.depth < 1) return null;
              const start = $from.start(1);
              const end = $from.end(1);
              const text = editor.state.doc.textBetween(start, end, '\n');
              return text.trim() ? { text, range: { from: start, to: end } } : null;
            },
          }
        : {
            getSelectionText: () => {
              const ta = taRef.current;
              return ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '';
            },
            captureSelection: () => {
              const ta = taRef.current;
              return ta
                ? { start: ta.selectionStart, end: ta.selectionEnd }
                : { start: 0, end: 0 };
            },
            replaceRange: async (range, text) => {
              const { start, end } = range as { start: number; end: number };
              const next = mdTextRef.current.slice(0, start) + text + mdTextRef.current.slice(end);
              setMdText(next);
              requestAnimationFrame(autoGrow);
              await persist(markdownToHtml(next));
            },
            appendToEnd: async (text) => {
              const base = mdTextRef.current.replace(/\s+$/, '');
              const next = base ? `${base}\n\n${text}` : text;
              setMdText(next);
              requestAnimationFrame(autoGrow);
              await persist(markdownToHtml(next));
            },
            captureBlock: () => {
              const ta = taRef.current;
              if (!ta) return null;
              const value = ta.value;
              const pos = ta.selectionStart;
              // paragraph = text between blank lines
              const before = value.lastIndexOf('\n\n', Math.max(0, pos - 1));
              const start = before === -1 ? 0 : before + 2;
              const after = value.indexOf('\n\n', pos);
              const end = after === -1 ? value.length : after;
              const text = value.slice(start, end);
              return text.trim() ? { text, range: { start, end } } : null;
            },
          };
    onBridgeReady(bridge);
  }, [editor, mode, currentScene?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMeta = useCallback(
    (data: Record<string, string>) => {
      if (currentScene) saveScene(currentScene.id, data).catch(console.error);
    },
    [currentScene, saveScene]
  );

  if (!currentScene) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-500">
        <div className="text-center">
          <p className="text-4xl mb-3">🖋</p>
          <p>Select a scene to start writing</p>
        </div>
      </div>
    );
  }

  const words: number =
    mode === 'md'
      ? countMdWords(mdText)
      : (editor?.storage.characterCount.words() ?? currentScene.word_count);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Scene toolbar */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-ink-800 shrink-0">
        <input
          className="bg-transparent text-ink-100 font-semibold text-base focus:outline-none flex-1 min-w-0"
          value={currentScene.title}
          onChange={(e) =>
            useNovelStore.setState({ currentScene: { ...currentScene, title: e.target.value } })
          }
          onBlur={(e) => updateMeta({ title: e.target.value })}
        />
        <select
          className="input w-auto py-1 text-xs"
          value={currentScene.status}
          onChange={(e) => updateMeta({ status: e.target.value })}
        >
          {SCENE_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          className={`btn text-xs px-2 font-mono ${mode === 'md' ? 'bg-accent-500/20 text-accent-400' : 'text-ink-400 hover:bg-ink-800'}`}
          onClick={toggleMode}
          title={mode === 'md' ? 'Switch to rich text' : 'Switch to markdown (plain text)'}
        >
          {mode === 'md' ? 'MD' : 'Aa'}
        </button>
        <button className="btn-ghost text-xs" onClick={() => setShowMeta((v) => !v)} title="Scene details">ℹ︎</button>
        <button className="btn-ghost text-xs" onClick={() => setShowSnapshots(true)} title="Version history">🕘</button>
        <button
          className="btn-ghost text-xs"
          onClick={() => setFocusMode(!focusMode)}
          title={focusMode ? 'Exit focus mode' : 'Focus mode'}
        >
          {focusMode ? '⤡' : '⤢'}
        </button>
        <span className="text-xs text-ink-500 w-24 text-right">
          {saving ? 'Saving…' : `${words.toLocaleString()} words`}
        </span>
      </div>

      {showMeta && (
        <div className="px-6 py-3 border-b border-ink-800 grid grid-cols-2 gap-3 shrink-0 bg-ink-900/50">
          <div>
            <label className="label">POV character</label>
            <input
              className="input"
              defaultValue={currentScene.pov}
              key={`pov-${currentScene.id}`}
              onBlur={(e) => updateMeta({ pov: e.target.value })}
              placeholder="Whose head are we in?"
            />
          </div>
          <div>
            <label className="label">Scene summary (feeds AI context)</label>
            <textarea
              className="input min-h-16"
              defaultValue={currentScene.summary}
              key={`sum-${currentScene.id}`}
              onBlur={(e) => updateMeta({ summary: e.target.value })}
              placeholder="What happens in this scene…"
            />
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-y-auto editor-surface">
        <div className="max-w-2xl mx-auto px-8 py-10">
          {mode === 'rich' ? (
            <EditorContent editor={editor} />
          ) : (
            <textarea
              ref={taRef}
              className="w-full bg-transparent font-mono text-[0.95rem] leading-[1.9] text-ink-100 placeholder-ink-600 focus:outline-none resize-none overflow-hidden min-h-[60vh]"
              placeholder={'Begin your scene…\n\nMarkdown: *italic*  **bold**  # heading  > quote'}
              value={mdText}
              spellCheck
              onChange={(e) => {
                setMdText(e.target.value);
                autoGrow();
                scheduleMdSave(e.target.value);
              }}
            />
          )}
        </div>
      </div>

      {showSnapshots && (
        <SnapshotsModal sceneId={currentScene.id} onClose={() => setShowSnapshots(false)} />
      )}
    </div>
  );
}
