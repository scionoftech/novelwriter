import { getSetting } from '../db';

export interface PromptTemplates {
  system: string;
  chatSystem: string;
  continue: string;
  rewrite: string;
  expand: string;
  shorten: string;
  improve: string;
  summarize: string;
}

export const DEFAULT_PROMPTS: PromptTemplates = {
  system: `You are an accomplished novelist working as the author's trusted co-writer. You write immersive, publishable fiction that matches the author's established voice, tense, and point of view exactly.

Rules:
- Study the story context carefully: the codex describes the world and characters, and the scene text shows the author's style.
- Stay consistent with every established fact. Never contradict the codex or earlier events.
- Show, don't tell. Use concrete sensory detail, subtext, and character-driven action.
- Write prose only — no headings, no notes, no explanations, no quotation of the instructions — unless the author explicitly asks for analysis.
- Match the author's paragraphing style and pacing.`,

  chatSystem: `You are a sharp, supportive story-development partner helping the author think through their novel. You know the full story context provided below. Brainstorm, answer questions, spot plot holes, and suggest ideas. Be specific and concrete; reference characters and events by name. Keep answers focused and practical.`,

  continue: `Continue writing this scene from exactly where the text leaves off. Carry the momentum of the current beat forward. Do not repeat or rephrase the existing text — write only what comes next.`,

  rewrite: `Rewrite the passage below according to the author's instruction. Preserve the meaning, plot facts, and point of view unless told otherwise. Return only the rewritten passage.`,

  expand: `Expand the passage below into a longer, richer version — add sensory detail, interiority, and beats while keeping the same events and voice. Return only the expanded passage.`,

  shorten: `Condense the passage below to roughly half its length while keeping its key beats, voice, and strongest lines. Return only the condensed passage.`,

  improve: `Improve the passage below at the line level: tighten loose phrasing, strengthen weak verbs, cut filler words, vary sentence rhythm, and sharpen imagery — while preserving the author's voice, meaning, POV, and tense exactly. Do not add new plot events or change what happens. Keep it close to the original length. Return only the improved passage.`,

  summarize: `Write a concise summary of the current scene in 2–4 sentences, covering what happens, who is involved, and any important changes or reveals. Return only the summary.`,
};

export function getPrompts(): PromptTemplates {
  const stored = getSetting<Partial<PromptTemplates>>('prompts', {});
  const merged = { ...DEFAULT_PROMPTS };
  for (const key of Object.keys(DEFAULT_PROMPTS) as (keyof PromptTemplates)[]) {
    const v = stored[key];
    if (typeof v === 'string' && v.trim()) merged[key] = v;
  }
  return merged;
}
