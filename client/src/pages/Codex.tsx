import { useMemo, useState } from 'react';
import { api } from '../api';
import { useNovelStore } from '../store';
import type { CodexEntry, CodexType } from '../types';

const TYPE_META: { id: CodexType; label: string; icon: string }[] = [
  { id: 'character', label: 'Characters', icon: '👤' },
  { id: 'location', label: 'Locations', icon: '📍' },
  { id: 'item', label: 'Items', icon: '🗝' },
  { id: 'lore', label: 'Lore', icon: '📜' },
  { id: 'other', label: 'Other', icon: '📦' },
];

function parseAliases(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((a) => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

export default function Codex() {
  const { novel, codex, refreshCodex } = useNovelStore();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  const selected = codex.find((e) => e.id === selectedId) ?? null;

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? codex.filter(
          (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
        )
      : codex;
    return TYPE_META.map((t) => ({ ...t, entries: filtered.filter((e) => e.type === t.id) }));
  }, [codex, filter]);

  if (!novel) return null;

  const create = async (type: CodexType) => {
    const entry = await api.createCodex(novel.id, { name: 'New entry', type });
    await refreshCodex();
    setSelectedId(entry.id);
  };

  const save = async (data: Partial<Omit<CodexEntry, 'aliases'>> & { aliases?: string[] }) => {
    if (!selected) return;
    await api.updateCodex(selected.id, data);
    await refreshCodex();
  };

  const remove = async () => {
    if (!selected) return;
    if (!confirm(`Delete codex entry "${selected.name}"?`)) return;
    await api.deleteCodex(selected.id);
    setSelectedId(null);
    await refreshCodex();
  };

  return (
    <div className="h-full flex">
      {/* List */}
      <aside className="w-80 shrink-0 border-r border-ink-800 overflow-y-auto">
        <div className="p-3 border-b border-ink-800 space-y-2">
          <input
            className="input"
            placeholder="Search codex…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {grouped.map((group) => (
          <div key={group.id}>
            <div className="flex items-center justify-between px-3 pt-4 pb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                {group.icon} {group.label}
              </span>
              <button className="btn-ghost px-1.5 py-0 text-xs" onClick={() => create(group.id)}>+</button>
            </div>
            {group.entries.map((entry) => (
              <div
                key={entry.id}
                className={`px-4 py-2 cursor-pointer text-sm ${
                  selectedId === entry.id ? 'bg-ink-800 text-ink-100' : 'text-ink-300 hover:bg-ink-850'
                }`}
                onClick={() => setSelectedId(entry.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate">{entry.name}</span>
                  {entry.always_include === 1 && <span title="Always in AI context" className="text-accent-500 text-xs">★</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </aside>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="max-w-2xl mx-auto p-8 space-y-5" key={selected.id}>
            <div className="flex items-center gap-3">
              <input
                className="input text-lg font-semibold flex-1"
                defaultValue={selected.name}
                onBlur={(e) => e.target.value.trim() && save({ name: e.target.value.trim() })}
              />
              <select
                className="input w-auto"
                defaultValue={selected.type}
                onChange={(e) => save({ type: e.target.value as CodexType })}
              >
                {TYPE_META.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Aliases (comma-separated — also matched in your text)</label>
              <input
                className="input"
                defaultValue={parseAliases(selected.aliases).join(', ')}
                onBlur={(e) =>
                  save({ aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
                placeholder="Liz, the Captain, her mother"
              />
            </div>
            <div>
              <label className="label">Description (injected into AI context when this entry is relevant)</label>
              <textarea
                className="input min-h-64 font-serif text-base leading-relaxed"
                defaultValue={selected.description}
                onBlur={(e) => save({ description: e.target.value })}
                placeholder="Everything the AI should know: appearance, personality, history, secrets, relationships…"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-300">
              <input
                type="checkbox"
                defaultChecked={selected.always_include === 1}
                onChange={(e) => save({ always_include: e.target.checked ? 1 : 0 })}
              />
              Always include in AI context (even when not mentioned)
            </label>
            <div className="pt-4 border-t border-ink-800">
              <button className="btn-danger text-xs" onClick={remove}>Delete entry</button>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-ink-500">
            <div className="text-center max-w-sm">
              <p className="text-4xl mb-3">📚</p>
              <p className="mb-2">Your story bible</p>
              <p className="text-xs text-ink-600">
                Characters, places, and lore you add here are automatically injected into the AI's
                context whenever they're mentioned in the scene you're writing.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
