import { useEffect, useState } from 'react';
import { api } from '../api';
import { useNovelStore } from '../store';
import type { Snapshot } from '../types';

interface Props {
  sceneId: number;
  onClose: () => void;
}

export default function SnapshotsModal({ sceneId, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [label, setLabel] = useState('');
  const { openScene, refreshTree, bumpReload } = useNovelStore();

  const refresh = () => api.listSnapshots(sceneId).then(setSnapshots).catch(console.error);
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  const take = async () => {
    await api.createSnapshot(sceneId, label.trim() || undefined);
    setLabel('');
    refresh();
  };

  const restore = async (id: number) => {
    if (!confirm('Restore this snapshot? Your current text will be snapshotted first.')) return;
    await api.restoreSnapshot(id);
    await openScene(sceneId);
    bumpReload();
    await refreshTree();
    onClose();
  };

  const remove = async (id: number) => {
    await api.deleteSnapshot(id);
    if (preview?.id === id) setPreview(null);
    refresh();
  };

  const show = async (snap: Snapshot) => {
    const full = await api.getSnapshot(snap.id);
    setPreview(full);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8" onClick={onClose}>
      <div className="card w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-800">
          <h3 className="font-semibold text-ink-100">🕘 Scene snapshots</h3>
          <button className="btn-ghost px-2" onClick={onClose}>✕</button>
        </div>
        <div className="p-4 flex gap-2 border-b border-ink-800">
          <input
            className="input"
            placeholder="Label (optional) — e.g. 'before big revision'"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className="btn-primary shrink-0" onClick={take}>+ Snapshot now</button>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="w-64 shrink-0 border-r border-ink-800 overflow-y-auto">
            {snapshots.map((s) => (
              <div
                key={s.id}
                className={`px-4 py-2.5 cursor-pointer border-b border-ink-850 ${preview?.id === s.id ? 'bg-ink-800' : 'hover:bg-ink-850'}`}
                onClick={() => show(s)}
              >
                <p className="text-sm text-ink-200">{s.label || 'Snapshot'}</p>
                <p className="text-xs text-ink-500">
                  {new Date(s.created_at + 'Z').toLocaleString()} · {s.word_count} words
                </p>
              </div>
            ))}
            {!snapshots.length && <p className="p-4 text-xs text-ink-500">No snapshots yet.</p>}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            {preview ? (
              <>
                <div
                  className="flex-1 overflow-y-auto p-5 font-serif text-sm leading-relaxed text-ink-200 [&_p]:mb-3"
                  dangerouslySetInnerHTML={{ __html: preview.content || '<p class="text-ink-500">(empty)</p>' }}
                />
                <div className="p-3 border-t border-ink-800 flex gap-2 justify-end">
                  <button className="btn-danger text-xs" onClick={() => remove(preview.id)}>Delete</button>
                  <button className="btn-primary text-xs" onClick={() => restore(preview.id)}>Restore this version</button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-ink-500 text-sm">
                Select a snapshot to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
