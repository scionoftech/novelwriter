import fs from 'fs';
import path from 'path';
import os from 'os';
import { db, getSetting } from '../db';
import { htmlToMarkdown } from '../util/text';

export interface SyncSettings {
  enabled: boolean;
  vaultPath: string;
}

export const DEFAULT_SYNC: SyncSettings = { enabled: false, vaultPath: '' };

const pending = new Map<number, ReturnType<typeof setTimeout>>();

const MARKER = '.novelwriter'; // proves a folder is app-managed and safe to rewrite

export function getSyncSettings(): SyncSettings {
  return { ...DEFAULT_SYNC, ...getSetting<Partial<SyncSettings>>('sync', {}) };
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function safeName(s: string): string {
  // Leading dots are stripped so a title like ".." can never resolve outside its folder.
  return (
    s.replace(/[/\\:*?"<>|#^[\]{}]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim() || 'Untitled'
  ).slice(0, 100);
}

function yamlStr(s: string): string {
  return JSON.stringify(s ?? '');
}

/**
 * Who owns a vault folder: undefined = no marker (not ours), null = legacy marker
 * written before ids were recorded, number = the owning novel's id.
 */
function markerOwner(dir: string): number | null | undefined {
  try {
    const text = fs.readFileSync(path.join(dir, MARKER), 'utf8');
    const m = text.match(/^novel-id:\s*(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch {
    return undefined;
  }
}

/** Top-level vault folders owned by this novel (by id, or a legacy marker at `legacyTitle`'s name). */
function ownedDirs(vault: string, novelId: number, legacyTitle?: string): string[] {
  const legacyName = legacyTitle === undefined ? null : safeName(legacyTitle);
  return fs
    .readdirSync(vault, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => {
      const owner = markerOwner(path.join(vault, e.name));
      return owner === novelId || (owner === null && e.name === legacyName);
    })
    .map((e) => path.join(vault, e.name));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface NovelRow { id: number; title: string; author: string; description: string; }
interface ChapterRow { id: number; title: string; }
interface SceneRow { id: number; title: string; content: string; summary: string; status: string; pov: string; word_count: number; }
interface CodexRow { type: string; name: string; aliases: string; description: string; always_include: number; }

/**
 * Mirror a novel into the Obsidian vault as Markdown (one-way: app → vault).
 * The novel's folder is app-managed: it is deleted and rewritten on every sync,
 * guarded by a marker file so we never touch a folder the app didn't create.
 */
export function syncNovelToVault(novelId: number): { files: number; dir: string } {
  const sync = getSyncSettings();
  if (!sync.enabled || !sync.vaultPath.trim()) throw new Error('Obsidian sync is not enabled in Settings');
  const vault = expandHome(sync.vaultPath.trim());
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
    throw new Error(`Vault folder not found: ${vault}`);
  }

  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId) as unknown as NovelRow | undefined;
  if (!novel) throw new Error(`Novel ${novelId} not found`);

  // Two novels can share a title, so a folder is only reused if it is ours (by id).
  // On a clash (another novel's mirror, or a folder we didn't create) fall back to "Title (id)".
  const base = safeName(novel.title);
  const usable = (dir: string) => {
    if (!fs.existsSync(dir)) return true;
    const owner = markerOwner(dir);
    return owner === novelId || owner === null;
  };
  let novelDir = path.join(vault, base);
  if (!usable(novelDir)) novelDir = path.join(vault, `${base} (${novelId})`);
  if (!usable(novelDir)) {
    throw new Error(`"${path.basename(novelDir)}" already exists in your vault but was not created by NovelWriter. Rename that folder and sync again.`);
  }
  if (path.resolve(novelDir) === path.resolve(vault)) throw new Error('Refusing to sync into the vault root');

  // Drop this novel's other mirrors (left behind by a rename or a title clash clearing up).
  for (const dir of ownedDirs(vault, novelId, novel.title)) {
    if (path.resolve(dir) !== path.resolve(novelDir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  if (fs.existsSync(novelDir)) fs.rmSync(novelDir, { recursive: true, force: true });
  fs.mkdirSync(novelDir, { recursive: true });
  fs.writeFileSync(
    path.join(novelDir, MARKER),
    `novel-id: ${novelId}\nThis folder is managed by NovelWriter. It is rewritten on every sync — edits made here will be lost.\n`
  );

  let files = 0;
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    files++;
  };

  // About note
  const chapters = db
    .prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY sort_order, id')
    .all(novelId) as unknown as ChapterRow[];
  const sceneStmt = db.prepare('SELECT * FROM scenes WHERE chapter_id = ? ORDER BY sort_order, id');
  const totalWords = chapters
    .flatMap((c) => sceneStmt.all(c.id) as unknown as SceneRow[])
    .reduce((s, sc) => s + sc.word_count, 0);

  write(
    path.join(novelDir, 'About.md'),
    [
      '---',
      `title: ${yamlStr(novel.title)}`,
      `author: ${yamlStr(novel.author)}`,
      `words: ${totalWords}`,
      'tags: [novelwriter]',
      '---',
      '',
      `# ${novel.title}`,
      '',
      novel.description || '',
      '',
      '> [!note] Managed by NovelWriter',
      '> This folder is a read-only mirror. Write in the NovelWriter app — every save re-syncs here.',
      '',
    ].join('\n')
  );

  // Manuscript
  chapters.forEach((chapter, ci) => {
    const chapterDir = path.join(novelDir, 'Manuscript', `${pad(ci + 1)} ${safeName(chapter.title)}`);
    const scenes = sceneStmt.all(chapter.id) as unknown as SceneRow[];
    scenes.forEach((scene, si) => {
      const fm = [
        '---',
        `scene: ${yamlStr(scene.title)}`,
        `chapter: ${yamlStr(chapter.title)}`,
        `status: ${yamlStr(scene.status)}`,
        scene.pov ? `pov: ${yamlStr(scene.pov)}` : null,
        `words: ${scene.word_count}`,
        scene.summary ? `summary: ${yamlStr(scene.summary)}` : null,
        'tags: [novelwriter/scene]',
        '---',
      ].filter(Boolean);
      write(
        path.join(chapterDir, `${pad(si + 1)} ${safeName(scene.title)}.md`),
        fm.join('\n') + '\n\n' + htmlToMarkdown(scene.content) + '\n'
      );
    });
  });

  // Codex
  const codex = db
    .prepare('SELECT * FROM codex_entries WHERE novel_id = ? ORDER BY type, name')
    .all(novelId) as unknown as CodexRow[];
  const typeLabel: Record<string, string> = {
    character: 'Characters',
    location: 'Locations',
    item: 'Items',
    lore: 'Lore',
    other: 'Other',
  };
  const usedCodexNames = new Set<string>(); // case-insensitive: macOS volumes are
  for (const entry of codex) {
    let aliases: string[] = [];
    try {
      const arr = JSON.parse(entry.aliases);
      if (Array.isArray(arr)) aliases = arr.filter((a) => typeof a === 'string');
    } catch {
      /* ignore */
    }
    const fm = [
      '---',
      aliases.length ? `aliases: [${aliases.map(yamlStr).join(', ')}]` : null,
      `tags: [novelwriter/codex/${entry.type}]`,
      entry.always_include ? 'always_include: true' : null,
      '---',
    ].filter(Boolean);
    // Same-named entries in one folder would overwrite each other.
    const folder = typeLabel[entry.type] ?? 'Other';
    const stem = safeName(entry.name);
    let fileStem = stem;
    for (let n = 2; usedCodexNames.has(`${folder}/${fileStem}`.toLowerCase()); n++) fileStem = `${stem} (${n})`;
    usedCodexNames.add(`${folder}/${fileStem}`.toLowerCase());
    write(
      path.join(novelDir, 'Codex', folder, `${fileStem}.md`),
      fm.join('\n') + `\n\n# ${entry.name}\n\n${entry.description}\n`
    );
  }

  return { files, dir: novelDir };
}

/**
 * Remove a novel's mirrored folder (after delete or rename). Only touches
 * folders carrying the app's marker file, and cancels any pending sync.
 */
export function removeNovelFromVault(novelId: number, title: string): void {
  clearTimeout(pending.get(novelId));
  pending.delete(novelId);
  const sync = getSyncSettings();
  if (!sync.enabled || !sync.vaultPath.trim()) return;
  const vault = expandHome(sync.vaultPath.trim());
  if (!fs.existsSync(vault)) return;
  for (const dir of ownedDirs(vault, novelId, title)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- Debounced auto-sync ----------

/** Schedule a vault sync ~2s after the last mutation (no-op when sync is disabled). */
export function scheduleVaultSync(novelId: number | null | undefined): void {
  if (!novelId) return;
  const sync = getSyncSettings();
  if (!sync.enabled || !sync.vaultPath.trim()) return;
  clearTimeout(pending.get(novelId));
  pending.set(
    novelId,
    setTimeout(() => {
      pending.delete(novelId);
      try {
        syncNovelToVault(novelId);
      } catch (e) {
        console.error('[vault sync]', e instanceof Error ? e.message : e);
      }
    }, 2000)
  );
}

export function novelIdOfChapter(chapterId: number | string): number | null {
  const row = db.prepare('SELECT novel_id FROM chapters WHERE id = ?').get(chapterId) as
    | { novel_id: number }
    | undefined;
  return row?.novel_id ?? null;
}

export function novelIdOfScene(sceneId: number | string): number | null {
  const row = db
    .prepare('SELECT c.novel_id AS novel_id FROM scenes s JOIN chapters c ON s.chapter_id = c.id WHERE s.id = ?')
    .get(sceneId) as { novel_id: number } | undefined;
  return row?.novel_id ?? null;
}

export function novelIdOfCodex(entryId: number | string): number | null {
  const row = db.prepare('SELECT novel_id FROM codex_entries WHERE id = ?').get(entryId) as
    | { novel_id: number }
    | undefined;
  return row?.novel_id ?? null;
}
