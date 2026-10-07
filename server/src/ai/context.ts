import { db } from '../db';
import { htmlToText, tailTrim } from '../util/text';
import { getAISettings } from './providers';

interface NovelRow {
  id: number;
  title: string;
  author: string;
  description: string;
}
interface SceneRow {
  id: number;
  chapter_id: number;
  title: string;
  content: string;
  summary: string;
  pov: string;
  sort_order: number;
}
interface ChapterRow {
  id: number;
  title: string;
  sort_order: number;
}
interface CodexRow {
  id: number;
  type: string;
  name: string;
  aliases: string;
  description: string;
  always_include: number;
}

const CODEX_TYPE_LABELS: Record<string, string> = {
  character: 'CHARACTERS',
  location: 'LOCATIONS',
  item: 'ITEMS',
  lore: 'LORE & WORLDBUILDING',
  other: 'OTHER',
};

const MAX_CODEX_CHARS = 12000;
const MAX_SUMMARY_CHARS = 20000;
const MAX_PREV_SCENE_CHARS = 5000;
const MAX_CURRENT_SCENE_CHARS = 12000;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Select codex entries relevant to the given text (name/alias match or always-include). */
function relevantCodex(novelId: number, searchText: string): CodexRow[] {
  const entries = db
    .prepare('SELECT * FROM codex_entries WHERE novel_id = ? ORDER BY type, name')
    .all(novelId) as unknown as CodexRow[];
  // Pinned entries first, so they are never crowded out by the size cap.
  entries.sort((a, b) => b.always_include - a.always_include);
  const haystack = searchText.toLowerCase();
  const selected: CodexRow[] = [];
  let used = 0;
  for (const entry of entries) {
    let include = entry.always_include === 1;
    if (!include) {
      let names: string[] = [entry.name];
      try {
        const aliases = JSON.parse(entry.aliases);
        if (Array.isArray(aliases)) names = names.concat(aliases.filter((a) => typeof a === 'string'));
      } catch {
        /* ignore malformed aliases */
      }
      include = names.some((n) => {
        const needle = n.trim().toLowerCase();
        if (needle.length < 2) return false;
        return new RegExp(`(^|[^\\p{L}])${escapeRegExp(needle)}([^\\p{L}]|$)`, 'u').test(haystack);
      });
    }
    if (include) {
      const cost = entry.name.length + entry.description.length + 20;
      if (used + cost > MAX_CODEX_CHARS) continue;
      used += cost;
      selected.push(entry);
    }
  }
  return selected;
}

function formatCodex(entries: CodexRow[]): string {
  if (!entries.length) return '';
  const byType = new Map<string, CodexRow[]>();
  for (const e of entries) {
    const list = byType.get(e.type) ?? [];
    list.push(e);
    byType.set(e.type, list);
  }
  const sections: string[] = [];
  for (const [type, list] of byType) {
    const label = CODEX_TYPE_LABELS[type] ?? type.toUpperCase();
    const body = list
      .map((e) => {
        let aliases = '';
        try {
          const arr = JSON.parse(e.aliases);
          if (Array.isArray(arr) && arr.length) aliases = ` (also known as: ${arr.join(', ')})`;
        } catch {
          /* ignore */
        }
        return `- ${e.name}${aliases}: ${e.description}`;
      })
      .join('\n');
    sections.push(`${label}:\n${body}`);
  }
  return sections.join('\n\n');
}

export interface SceneContext {
  contextBlock: string;
  novel: NovelRow;
  scene: SceneRow | null;
  sceneText: string;
}

/**
 * Build the story-context block injected into the system prompt:
 * novel info, relevant codex entries, story-so-far summaries, recent scene
 * text, and the current scene.
 */
export function buildSceneContext(
  novelId: number,
  sceneId: number | null,
  extraSearchText = ''
): SceneContext {
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId) as NovelRow | undefined;
  if (!novel) throw new Error(`Novel ${novelId} not found`);

  const chapters = db
    .prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY sort_order, id')
    .all(novelId) as unknown as ChapterRow[];

  const allScenes = db
    .prepare(
      `SELECT s.* FROM scenes s JOIN chapters c ON s.chapter_id = c.id
       WHERE c.novel_id = ? ORDER BY c.sort_order, c.id, s.sort_order, s.id`
    )
    .all(novelId) as unknown as SceneRow[];

  const currentIndex = sceneId == null ? allScenes.length : allScenes.findIndex((s) => s.id === sceneId);
  const scene = sceneId == null ? null : (allScenes[currentIndex] ?? null);
  const sceneText = scene ? htmlToText(scene.content) : '';
  const settings = getAISettings();

  const parts: string[] = [];

  parts.push(
    `NOVEL: "${novel.title}"${novel.author ? ` by ${novel.author}` : ''}` +
      (novel.description ? `\nPremise: ${novel.description}` : '')
  );

  // Codex — match against current scene text, nearby text, and the request itself
  const prevScenes = currentIndex > 0 ? allScenes.slice(0, currentIndex) : sceneId == null ? allScenes : [];
  const recentCount = Math.max(0, settings.contextScenes);
  // slice(-0) would return everything, so handle 0 explicitly
  const recentPrev = recentCount === 0 ? [] : prevScenes.slice(-recentCount);
  const searchText = [
    sceneText,
    extraSearchText,
    ...recentPrev.map((s) => htmlToText(s.content)),
  ].join('\n');
  const codex = formatCodex(relevantCodex(novelId, searchText));
  if (codex) parts.push(`STORY CODEX (established facts — stay consistent with these):\n${codex}`);

  // Story so far — summaries of earlier scenes
  const summaryLines: string[] = [];
  for (const s of prevScenes) {
    if (s.summary.trim()) {
      const chapter = chapters.find((c) => c.id === s.chapter_id);
      summaryLines.push(`- [${chapter?.title ?? 'Chapter'} / ${s.title}] ${s.summary.trim()}`);
    }
  }
  // Keep the most recent summaries if they exceed the budget.
  const keptSummaries: string[] = [];
  let summaryChars = 0;
  for (let i = summaryLines.length - 1; i >= 0; i--) {
    summaryChars += summaryLines[i].length + 1;
    if (summaryChars > MAX_SUMMARY_CHARS) break;
    keptSummaries.unshift(summaryLines[i]);
  }
  if (keptSummaries.length) {
    const omitted = summaryLines.length - keptSummaries.length;
    parts.push(
      `STORY SO FAR (scene summaries in order${omitted ? `; ${omitted} earliest omitted` : ''}):\n${keptSummaries.join('\n')}`
    );
  }

  // Full text of the most recent preceding scenes
  for (const s of recentPrev) {
    const text = htmlToText(s.content);
    if (text) parts.push(`PRECEDING SCENE ("${s.title}"):\n${tailTrim(text, MAX_PREV_SCENE_CHARS)}`);
  }

  // Current scene
  if (scene) {
    const header = `CURRENT SCENE ("${scene.title}"${scene.pov ? `, POV: ${scene.pov}` : ''})`;
    parts.push(sceneText ? `${header}:\n${tailTrim(sceneText, MAX_CURRENT_SCENE_CHARS)}` : `${header}: (empty so far)`);
  }

  return { contextBlock: parts.join('\n\n---\n\n'), novel, scene, sceneText };
}
