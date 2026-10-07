# ✒️ NovelWriter

A personal, local-first novel-writing studio in the spirit of Novelcrafter — with AI assistance
from **Anthropic (Claude)**, **AWS Bedrock**, or **local Ollama models**. Your manuscript lives in
a SQLite database on your Mac; nothing leaves your machine except the AI calls you make.

## Features

- **Manuscript editor** — chapters and scenes, rich-text prose editor (TipTap), autosave,
  live word counts, scene status tracking, distraction-free focus mode.
- **Codex / story bible** — characters, locations, items, and lore. Entries are automatically
  injected into the AI's context whenever their name (or an alias) appears in the scene you're
  working on. Mark entries "always include" to pin them.
- **AI writing tools** — Continue writing, Rewrite / Expand / Shorten a selection, Summarize
  scene — all with your novel's premise, codex, scene summaries, and recent prose as context.
  Output streams into a review panel; you decide whether to apply it.
- **Story chat** — brainstorm with an AI that knows your whole story. Conversations are saved.
- **Plan board** — kanban-style view of chapters and scenes with inline summaries and statuses.
- **Snapshots** — manual version history per scene, with preview and one-click restore
  (restoring auto-snapshots your current text first).
- **Export** — compile to Markdown, plain text, or Word (.docx) with italics/bold preserved.
- **Obsidian vault sync** — mirrors each novel into your vault as Markdown: scenes under
  `Manuscript/` with frontmatter (status, POV, summary), codex entries under `Codex/` with
  Obsidian aliases and tags. Re-syncs automatically ~2s after every save.
- **Markdown mode** — toggle the editor (Aa / MD button) between rich text and a plain-text
  markdown view (`*italic*`, `**bold**`, `#` headings) that converts losslessly both ways.
- **Import** — bring in existing manuscripts, drafts, or plot notes from **.docx, .pdf, .md,
  or .txt**. Chapters are detected from headings and "Chapter …" lines, scenes from `***`
  separators and horizontal rules, with a preview before anything is created. Import as a
  new novel (Library → 📥 Import) or append chapters into the current one (Export ▾ menu).

## Requirements

- **Bun 1.4+** (runs the server and installs dependencies). Built-in `node:sqlite` is used for storage — no native modules.
- An **Anthropic API key**, AWS credentials for **Bedrock**, or a running **Ollama** — configure
  any or all in Settings.

## Getting started

```bash
bun install
bun run build
bun run start         # → http://127.0.0.1:3717
```

Open http://127.0.0.1:3717, go to **⚙ Settings**, pick a provider, and paste your key:

| Provider | What you need |
|---|---|
| Anthropic API | An API key from console.anthropic.com (or set `ANTHROPIC_API_KEY` in the environment — the Settings field can stay blank). Default model: `claude-opus-4-8`. |
| AWS Bedrock | A region + AWS credentials (either entered in Settings or via your standard AWS credential chain / `~/.aws`). Model IDs are prefixed automatically (`anthropic.claude-…`). |
| Ollama | Ollama running locally (`ollama serve`); pick any pulled model. |

Then create a novel and start writing.

**Thinking:** Anthropic and Bedrock requests use extended thinking where the model supports it
(adaptive for Opus/Sonnet 4.6+, a fixed budget for Haiku 4.5, none for older models). Thinking
shares the output token budget, so the app raises `max_tokens` to leave room for the prose.

### Development mode

```bash
bun run dev        # server on :3717 + Vite dev server on :5173 with hot reload
```

## How the AI context works

Every AI request is assembled server-side from:

1. Your novel's title and premise,
2. Codex entries mentioned in the current scene / recent scenes (plus ★ always-include entries),
3. Scene summaries of everything that came before ("story so far"),
4. The full text of the last N preceding scenes (configurable in Settings),
5. The current scene's text.

**Tips for best results:** fill in scene summaries as you go (or use *Summarize scene* to
generate them), and keep codex descriptions rich — they're what keeps the AI consistent with
your world.

## Obsidian sync (one-way mirror)

Enable it in **Settings → Obsidian Sync** and point it at your vault folder. Each novel gets
its own folder in the vault, protected by a `.novelwriter` marker — the app refuses to touch
any folder it didn't create.

**Direction matters:** SQLite is the source of truth; the vault folder is a read-only mirror
that is rewritten on every sync. Write in NovelWriter; read, link, and graph in Obsidian.
Edits made to the mirrored files in Obsidian will be overwritten on the next save. Use the
Export ▾ → "Sync to Obsidian" menu for an immediate manual sync.

## Your data

Everything is stored in `data/novelwriter.db` (SQLite, WAL mode). **To back up your novel,
copy the `data/` folder** — or use Export for a readable copy. The server binds to
`127.0.0.1` only.

API keys are stored in the same local database and never sent anywhere except the provider
you configured. Environment variables (`ANTHROPIC_API_KEY`, AWS credential chain) take over
when the Settings fields are left blank.

## Architecture

```
server/   Express + node:sqlite + Anthropic/Bedrock SDKs
          ├─ REST API (novels, chapters, scenes, codex, snapshots, chats, settings, export, sync, import)
          └─ POST /api/ai/generate — SSE streaming for all AI actions
client/   React + Vite + TypeScript + Tailwind + TipTap + Zustand
```

Useful environment variables: `PORT` (default 3717), `HOST` (default 127.0.0.1),
`NOVELWRITER_DATA_DIR` (default `./data`), `ANTHROPIC_API_KEY`.

The server rejects requests with a foreign `Origin`, or a foreign `Host` when bound to loopback.
To serve the UI from another port or hostname, add it to `ALLOWED_ORIGINS` / `ALLOWED_HOSTS`
in `server/src/index.ts`.
