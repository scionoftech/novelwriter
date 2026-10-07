import { useEffect, useRef, useState } from 'react';
import { streamGenerate } from '../api';
import { useNovelStore } from '../store';
import type { AIAction } from '../types';
import type { EditorBridge } from '../lib/editorBridge';

interface Props {
  bridge: EditorBridge | null;
}

type PanelAction = Exclude<AIAction, 'chat'>;

interface ActionDef {
  id: PanelAction;
  label: string;
  /** 'selection' = requires a selection; 'block' = falls back to the paragraph under the cursor; 'none' = whole scene */
  target: 'selection' | 'block' | 'none';
  hint: string;
}

const ACTIONS: ActionDef[] = [
  { id: 'continue', label: '✍️ Continue writing', target: 'none', hint: 'Writes the next beat of the current scene' },
  { id: 'improve', label: '✨ Improve', target: 'block', hint: 'Polishes the selection — or the paragraph under your cursor — without changing what happens' },
  { id: 'rewrite', label: '🔁 Rewrite selection', target: 'selection', hint: 'Rewrites the selected passage per your instruction' },
  { id: 'expand', label: '↔️ Expand selection', target: 'selection', hint: 'Makes the selected passage longer and richer' },
  { id: 'shorten', label: '✂️ Shorten selection', target: 'selection', hint: 'Condenses the selected passage' },
  { id: 'summarize', label: '📝 Summarize scene', target: 'none', hint: 'Generates a scene summary for your outline' },
];

export default function AIPanel({ bridge }: Props) {
  const { novel, currentScene, saveScene, refreshTree } = useNovelStore();
  const [instruction, setInstruction] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [lastAction, setLastAction] = useState<PanelAction | null>(null);
  const [capturedRange, setCapturedRange] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Output belongs to the scene it was generated for: applying it to another scene
  // would replace the wrong text or overwrite the wrong summary. Also stop paying for
  // a stream nobody is watching when the panel goes away.
  const sceneId = currentScene?.id;
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      setOutput('');
      setError('');
      setCapturedRange(null);
    };
  }, [sceneId]);

  if (!novel) return null;

  const run = async (action: PanelAction) => {
    if (!currentScene || !bridge) {
      setError('Open a scene first.');
      return;
    }
    const target = ACTIONS.find((a) => a.id === action)?.target ?? 'none';
    let sel = bridge.getSelectionText();
    let range: unknown = null;
    if (target === 'selection') {
      if (!sel.trim()) {
        setError('Select some text in the editor first.');
        return;
      }
      range = bridge.captureSelection();
    } else if (target === 'block') {
      if (sel.trim()) {
        range = bridge.captureSelection();
      } else {
        const block = bridge.captureBlock();
        if (!block) {
          setError('Put your cursor in a paragraph (or select text) first.');
          return;
        }
        sel = block.text;
        range = block.range;
      }
    }
    setError('');
    setOutput('');
    setRunning(true);
    setLastAction(action);
    setCapturedRange(range);

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamGenerate(
        {
          action,
          novelId: novel.id,
          sceneId: currentScene.id,
          selection: target !== 'none' ? sel : undefined,
          instruction: instruction.trim() || undefined,
        },
        (delta) => {
          setOutput((prev) => prev + delta);
          outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
        },
        abort.signal
      );
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const apply = async () => {
    if (!currentScene || !bridge || !output.trim()) return;
    if (lastAction === 'summarize') {
      await saveScene(currentScene.id, { summary: output.trim() });
      await refreshTree();
    } else if (capturedRange != null) {
      await bridge.replaceRange(capturedRange, output.trim());
    } else {
      await bridge.appendToEnd(output.trim());
    }
    setOutput('');
  };

  return (
    <aside className="w-80 shrink-0 border-l border-ink-800 flex flex-col">
      <div className="p-3 border-b border-ink-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">AI Assistant</span>
      </div>

      <div className="p-3 space-y-2 border-b border-ink-800">
        <textarea
          className="input min-h-16 text-xs"
          placeholder="Optional guidance for the AI — e.g. 'raise the tension, end on the knock at the door'"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <div className="grid gap-1.5">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              className="btn-secondary justify-start text-xs"
              title={a.hint}
              disabled={running || !currentScene}
              onClick={() => run(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-ink-400">{running ? 'Writing…' : output ? 'Draft' : ''}</span>
          {running && <button className="btn-danger py-0.5 px-2 text-xs" onClick={stop}>■ Stop</button>}
        </div>
        {error && <div className="mb-2 rounded bg-red-900/40 text-red-200 px-3 py-2 text-xs">{error}</div>}
        <div
          ref={outputRef}
          className="flex-1 overflow-y-auto rounded-md bg-ink-900 border border-ink-800 p-3 text-sm font-serif leading-relaxed whitespace-pre-wrap text-ink-200"
        >
          {output || (
            <span className="text-ink-600 font-sans text-xs">
              AI output appears here. Review it, then apply it to your manuscript or discard it.
            </span>
          )}
        </div>
        {output && !running && (
          <div className="flex gap-2 mt-2">
            <button className="btn-primary flex-1 text-xs" onClick={apply}>
              {lastAction === 'summarize' ? 'Save as summary' : capturedRange != null ? 'Replace selection' : 'Insert into scene'}
            </button>
            <button className="btn-ghost text-xs" onClick={() => lastAction && run(lastAction)}>↻ Retry</button>
            <button className="btn-ghost text-xs" onClick={() => setOutput('')}>Discard</button>
          </div>
        )}
      </div>
    </aside>
  );
}
