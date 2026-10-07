import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { api } from '../api';
import { useNovelStore } from '../store';
import ImportModal from '../components/ImportModal';

const tabs = [
  { to: 'write', label: 'Write', icon: '✍️' },
  { to: 'plan', label: 'Plan', icon: '🗂' },
  { to: 'codex', label: 'Codex', icon: '📚' },
  { to: 'chat', label: 'Chat', icon: '💬' },
];

export default function NovelLayout() {
  const { novelId } = useParams();
  const { novel, chapters, loadNovel, focusMode } = useNovelStore();
  const [exportOpen, setExportOpen] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [showImport, setShowImport] = useState(false);

  const syncNow = async () => {
    if (!novel) return;
    setExportOpen(false);
    try {
      const r = await api.syncNovel(novel.id);
      setSyncMsg(`✓ Synced ${r.files} notes to vault`);
    } catch (e) {
      setSyncMsg(`⚠ ${e instanceof Error ? e.message : e}`);
    }
    setTimeout(() => setSyncMsg(''), 5000);
  };

  useEffect(() => {
    if (novelId) loadNovel(Number(novelId)).catch(console.error);
  }, [novelId, loadNovel]);

  const totalWords = chapters.reduce(
    (sum, c) => sum + c.scenes.reduce((s, sc) => s + sc.word_count, 0),
    0
  );

  return (
    <div className="h-full flex flex-col">
      {!focusMode && (
        <header className="border-b border-ink-800 px-4 py-2 flex items-center gap-4 shrink-0">
          <Link to="/" className="btn-ghost px-2" title="Back to library">←</Link>
          <span className="font-semibold text-ink-100 truncate max-w-64">{novel?.title ?? '…'}</span>
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `btn ${isActive ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'}`
                }
              >
                <span className="text-xs">{t.icon}</span> {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          {syncMsg && <span className="text-xs text-ink-300 truncate max-w-72" title={syncMsg}>{syncMsg}</span>}
          <span className="text-xs text-ink-500">{totalWords.toLocaleString()} words</span>
          <div className="relative">
            <button className="btn-secondary" onClick={() => setExportOpen((v) => !v)}>Export ▾</button>
            {exportOpen && novel && (
              <div className="absolute right-0 top-full mt-1 card p-1 z-20 w-40" onMouseLeave={() => setExportOpen(false)}>
                {(['markdown', 'docx', 'text'] as const).map((format) => (
                  <a
                    key={format}
                    href={api.exportUrl(novel.id, format)}
                    className="block px-3 py-1.5 text-sm rounded hover:bg-ink-700 text-ink-200"
                    onClick={() => setExportOpen(false)}
                  >
                    {format === 'markdown' ? 'Markdown (.md)' : format === 'docx' ? 'Word (.docx)' : 'Plain text (.txt)'}
                  </a>
                ))}
                <button
                  className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-ink-700 text-ink-200 border-t border-ink-800 mt-1 pt-2"
                  onClick={syncNow}
                >
                  🔮 Sync to Obsidian
                </button>
                <button
                  className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-ink-700 text-ink-200"
                  onClick={() => {
                    setExportOpen(false);
                    setShowImport(true);
                  }}
                >
                  📥 Import chapters…
                </button>
              </div>
            )}
          </div>
          <Link to="/settings" className="btn-ghost px-2" title="Settings">⚙</Link>
        </header>
      )}
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
      {showImport && novel && (
        <ImportModal
          novelId={novel.id}
          onClose={() => setShowImport(false)}
          onImported={async (r) => {
            setShowImport(false);
            await loadNovel(novel.id);
            setSyncMsg(`✓ Imported ${r.chapterCount} chapters, ${r.sceneCount} scenes`);
            setTimeout(() => setSyncMsg(''), 5000);
          }}
        />
      )}
    </div>
  );
}
