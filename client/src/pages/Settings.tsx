import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { SettingsPayload, ProviderId, PromptTemplates } from '../types';

const PROVIDERS: { id: ProviderId; label: string; blurb: string }[] = [
  { id: 'anthropic', label: 'Anthropic API', blurb: 'Claude models via your Anthropic API key — best prose quality.' },
  { id: 'bedrock', label: 'AWS Bedrock', blurb: 'Claude via your AWS account (uses AWS credentials / region).' },
  { id: 'ollama', label: 'Ollama (local)', blurb: 'Free local models running on your Mac — private and offline.' },
];

const PROMPT_LABELS: Record<keyof PromptTemplates, string> = {
  system: 'Prose system prompt',
  chatSystem: 'Chat system prompt',
  continue: 'Continue writing',
  rewrite: 'Rewrite selection',
  expand: 'Expand selection',
  shorten: 'Shorten selection',
  improve: 'Improve passage',
  summarize: 'Summarize scene',
};

export default function Settings() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [showPrompts, setShowPrompts] = useState(false);

  useEffect(() => {
    api.getSettings().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!data) return;
    api.listModels(data.ai.provider).then(setModels).catch(() => setModels([]));
  }, [data?.ai.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) {
    return <div className="p-10 text-ink-500">{error || 'Loading…'}</div>;
  }

  const setAI = (patch: Partial<SettingsPayload['ai']>) =>
    setData({ ...data, ai: { ...data.ai, ...patch } });

  const setSync = (patch: Partial<SettingsPayload['sync']>) =>
    setData({ ...data, sync: { ...data.sync, ...patch } });

  const setPrompt = (key: keyof PromptTemplates, value: string) =>
    setData({ ...data, prompts: { ...data.prompts, [key]: value } });

  const save = async () => {
    setError('');
    try {
      await api.saveSettings({ ai: data.ai, sync: data.sync, prompts: data.prompts });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setData(await api.getSettings());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ai = data.ai;

  return (
    <div className="min-h-full">
      <header className="border-b border-ink-800 px-8 py-4 flex items-center gap-4">
        <Link to="/" className="btn-ghost px-2">←</Link>
        <h1 className="text-lg font-semibold text-ink-100">Settings</h1>
      </header>

      <main className="max-w-2xl mx-auto px-8 py-8 space-y-8 pb-24">
        {error && <div className="rounded bg-red-900/40 text-red-200 px-4 py-2 text-sm">{error}</div>}

        <section className="space-y-4">
          <h2 className="text-base font-semibold text-ink-100">AI Provider</h2>
          <div className="grid gap-2">
            {PROVIDERS.map((p) => (
              <label
                key={p.id}
                className={`card p-4 cursor-pointer flex gap-3 items-start ${ai.provider === p.id ? 'border-accent-500/60' : ''}`}
              >
                <input
                  type="radio"
                  name="provider"
                  checked={ai.provider === p.id}
                  onChange={() => setAI({ provider: p.id })}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium text-ink-100">{p.label}</span>
                  <span className="block text-xs text-ink-400">{p.blurb}</span>
                </span>
              </label>
            ))}
          </div>

          {ai.provider === 'anthropic' && (
            <div>
              <label className="label">Anthropic API key</label>
              <input
                className="input"
                type="password"
                value={ai.anthropic.apiKey}
                onChange={(e) => setAI({ anthropic: { apiKey: e.target.value } })}
                placeholder={data.anthropicEnvKey ? 'Using ANTHROPIC_API_KEY from environment' : 'sk-ant-…'}
              />
              {data.anthropicEnvKey && !ai.anthropic.apiKey && (
                <p className="text-xs text-ink-500 mt-1">✓ ANTHROPIC_API_KEY found in the server environment; leave blank to use it.</p>
              )}
            </div>
          )}

          {ai.provider === 'bedrock' && (
            <div className="grid gap-3">
              <div>
                <label className="label">AWS region</label>
                <input
                  className="input"
                  value={ai.bedrock.region}
                  onChange={(e) => setAI({ bedrock: { ...ai.bedrock, region: e.target.value } })}
                  placeholder="us-east-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Access key ID (optional)</label>
                  <input
                    className="input"
                    value={ai.bedrock.accessKeyId}
                    onChange={(e) => setAI({ bedrock: { ...ai.bedrock, accessKeyId: e.target.value } })}
                    placeholder="Uses AWS credential chain if empty"
                  />
                </div>
                <div>
                  <label className="label">Secret access key (optional)</label>
                  <input
                    className="input"
                    type="password"
                    value={ai.bedrock.secretAccessKey}
                    onChange={(e) => setAI({ bedrock: { ...ai.bedrock, secretAccessKey: e.target.value } })}
                  />
                </div>
              </div>
            </div>
          )}

          {ai.provider === 'ollama' && (
            <div>
              <label className="label">Ollama base URL</label>
              <input
                className="input"
                value={ai.ollama.baseUrl}
                onChange={(e) => setAI({ ollama: { baseUrl: e.target.value } })}
                placeholder="http://localhost:11434"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Model</label>
              <select className="input" value={ai.model} onChange={(e) => setAI({ model: e.target.value })}>
                {!models.some((m) => m.id === ai.model) && ai.model && (
                  <option value={ai.model}>{ai.model}</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <input
                className="input mt-2"
                value={ai.model}
                onChange={(e) => setAI({ model: e.target.value })}
                placeholder="…or type a model ID"
              />
            </div>
            <div className="grid gap-3 content-start">
              <div>
                <label className="label">Max output tokens</label>
                <input
                  className="input"
                  type="number"
                  min={256}
                  max={64000}
                  value={ai.maxTokens}
                  onChange={(e) => setAI({ maxTokens: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Preceding scenes in AI context</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10}
                  value={ai.contextScenes}
                  onChange={(e) => setAI({ contextScenes: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-base font-semibold text-ink-100">Obsidian Sync</h2>
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              checked={data.sync.enabled}
              onChange={(e) => setSync({ enabled: e.target.checked })}
            />
            Mirror novels to an Obsidian vault as Markdown
          </label>
          {data.sync.enabled && (
            <div>
              <label className="label">Vault folder path</label>
              <input
                className="input"
                value={data.sync.vaultPath}
                onChange={(e) => setSync({ vaultPath: e.target.value })}
                placeholder="~/Documents/MyVault"
              />
              <p className="text-xs text-ink-500 mt-2 leading-relaxed">
                Each novel becomes a folder in your vault: scenes under <code className="text-ink-400">Manuscript/</code> with
                frontmatter (status, POV, summary), codex entries under <code className="text-ink-400">Codex/</code> with
                Obsidian aliases. The mirror re-syncs ~2s after every save.
                <br />
                <span className="text-amber-500/80">One-way: app → vault.</span> The novel's folder is
                rewritten on each sync, so edits made to those files in Obsidian will be overwritten —
                write in NovelWriter, read/link/graph in Obsidian.
              </p>
            </div>
          )}
        </section>

        <section>
          <button className="btn-secondary text-xs" onClick={() => setShowPrompts((v) => !v)}>
            {showPrompts ? '▾' : '▸'} Customize AI prompts
          </button>
          {showPrompts && (
            <div className="mt-4 space-y-4">
              {(Object.keys(PROMPT_LABELS) as (keyof PromptTemplates)[]).map((key) => (
                <div key={key}>
                  <div className="flex items-center justify-between">
                    <label className="label">{PROMPT_LABELS[key]}</label>
                    {data.prompts[key] !== data.defaultPrompts[key] && (
                      <button
                        className="text-xs text-accent-500 hover:text-accent-400"
                        onClick={() => setPrompt(key, data.defaultPrompts[key])}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <textarea
                    className="input min-h-24 text-xs font-mono"
                    value={data.prompts[key]}
                    onChange={(e) => setPrompt(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <div className="fixed bottom-0 inset-x-0 border-t border-ink-800 bg-ink-950/90 backdrop-blur px-8 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-end gap-3">
          {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
          <button className="btn-primary" onClick={save}>Save settings</button>
        </div>
      </div>
    </div>
  );
}
