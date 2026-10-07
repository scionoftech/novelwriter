import { useRef, useState } from 'react';
import { importManuscript, ImportPreview, ImportResult } from '../api';

interface Props {
  /** When set, imported chapters are appended to this novel instead of creating a new one. */
  novelId?: number;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

export default function ImportModal({ novelId, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | null) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setError('');
    setBusy(true);
    try {
      const p = await importManuscript(f, { dryRun: true });
      setPreview(p);
      setTitle(p.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await importManuscript(file, {
        dryRun: false,
        novelId,
        title: novelId ? undefined : title.trim() || undefined,
      });
      onImported(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8" onClick={onClose}>
      <div className="card w-full max-w-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-800">
          <h3 className="font-semibold text-ink-100">
            📥 {novelId ? 'Import into this novel' : 'Import manuscript'}
          </h3>
          <button className="btn-ghost px-2" onClick={onClose}>✕</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div
            className="border-2 border-dashed border-ink-700 rounded-lg p-8 text-center cursor-pointer hover:border-ink-500 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".docx,.pdf,.md,.markdown,.txt,.text"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="text-sm text-ink-200">📄 {file.name}</p>
            ) : (
              <>
                <p className="text-sm text-ink-300 mb-1">Drop a file here, or click to choose</p>
                <p className="text-xs text-ink-500">.docx · .pdf · .md · .txt</p>
              </>
            )}
          </div>

          {busy && !preview && <p className="text-sm text-ink-400">Reading file…</p>}
          {error && <div className="rounded bg-red-900/40 text-red-200 px-3 py-2 text-sm">{error}</div>}

          {preview && (
            <>
              {!novelId && (
                <div>
                  <label className="label">Novel title</label>
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
                  {preview.author && <p className="text-xs text-ink-500 mt-1">Detected author: {preview.author}</p>}
                </div>
              )}
              <div className="card bg-ink-850 p-4">
                <p className="text-sm text-ink-200 mb-2">
                  Found <strong>{preview.chapters.length}</strong> chapter{preview.chapters.length !== 1 && 's'},{' '}
                  <strong>{preview.chapters.reduce((s, c) => s + c.sceneCount, 0)}</strong> scenes,{' '}
                  <strong>{preview.totalWords.toLocaleString()}</strong> words
                </p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {preview.chapters.map((c, i) => (
                    <div key={i} className="text-xs text-ink-400 flex justify-between gap-2">
                      <span className="truncate">{c.title}</span>
                      <span className="shrink-0 text-ink-500">
                        {c.sceneCount} scene{c.sceneCount !== 1 && 's'} · {c.words.toLocaleString()} w
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-ink-500 leading-relaxed">
                Chapters are detected from headings and “Chapter …” lines; scene breaks from
                <code className="text-ink-400"> *** </code> separators and horizontal rules. You can
                reorganize everything afterwards.
              </p>
            </>
          )}
        </div>

        <div className="p-4 border-t border-ink-800 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!preview || busy} onClick={commit}>
            {busy && preview ? 'Importing…' : novelId ? 'Append chapters' : 'Import novel'}
          </button>
        </div>
      </div>
    </div>
  );
}
