import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import ImportModal from '../components/ImportModal';
import type { Novel } from '../types';

export default function Library() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.listNovels().then(setNovels).catch((e) => setError(e.message));
  }, []);

  const create = async () => {
    if (!title.trim()) return;
    try {
      const novel = await api.createNovel({ title: title.trim(), author, description });
      navigate(`/novel/${novel.id}/write`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (novel: Novel) => {
    if (!confirm(`Delete "${novel.title}" and all its contents? This cannot be undone.`)) return;
    await api.deleteNovel(novel.id);
    setNovels(await api.listNovels());
  };

  return (
    <div className="min-h-full">
      <header className="border-b border-ink-800 px-8 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink-100">
          ✒️ NovelWriter <span className="text-ink-500 font-normal text-sm ml-2">your writing studio</span>
        </h1>
        <Link to="/settings" className="btn-ghost">⚙ Settings</Link>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-10">
        {error && <div className="mb-4 rounded-md bg-red-900/40 text-red-200 px-4 py-2 text-sm">{error}</div>}

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-ink-100">Your Novels</h2>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setShowImport(true)}>📥 Import</button>
            <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Novel</button>
          </div>
        </div>

        {showImport && (
          <ImportModal
            onClose={() => setShowImport(false)}
            onImported={(r) => navigate(`/novel/${r.novelId}/write`)}
          />
        )}

        {showCreate && (
          <div className="card p-5 mb-8">
            <div className="grid gap-4">
              <div>
                <label className="label">Title</label>
                <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="The Winds of Elsewhere" />
              </div>
              <div>
                <label className="label">Author</label>
                <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your pen name" />
              </div>
              <div>
                <label className="label">Premise / synopsis (used as AI context)</label>
                <textarea className="input min-h-24" value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="A one-paragraph premise of your novel…" />
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn-primary" onClick={create} disabled={!title.trim()}>Create</button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4">
          {novels.map((novel) => (
            <div key={novel.id} className="card p-5 flex items-start justify-between gap-4 hover:border-ink-600 transition-colors">
              <Link to={`/novel/${novel.id}/write`} className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-ink-100">{novel.title}</h3>
                {novel.author && <p className="text-sm text-ink-400">by {novel.author}</p>}
                {novel.description && (
                  <p className="text-sm text-ink-300 mt-2 line-clamp-2">{novel.description}</p>
                )}
                <p className="text-xs text-ink-500 mt-3">
                  {novel.chapter_count ?? 0} chapters · {(novel.word_count ?? 0).toLocaleString()} words
                  · updated {new Date(novel.updated_at + 'Z').toLocaleDateString()}
                </p>
              </Link>
              <button className="btn-ghost text-red-400" title="Delete novel" onClick={() => remove(novel)}>✕</button>
            </div>
          ))}
          {!novels.length && !showCreate && (
            <div className="text-center py-16 text-ink-500">
              <p className="text-4xl mb-3">📖</p>
              <p>No novels yet. Create your first one to start writing.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
