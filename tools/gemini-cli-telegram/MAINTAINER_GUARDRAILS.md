# Maintainer Guardrails

This file is a quick handoff note for Codex, Gemini CLI, Claude Code, or any
future helper editing this bridge. It focuses on rules that are easy to break
accidentally.

## Telegram Thinking UI

- Hidden thinking and the final reply must stay in one Telegram message bubble.
- The active hidden-thinking path is `buildHiddenThinkingSingleBubblePlan()` in
  `telegram-gem-bridge.cjs`.
- That path uses Telegram `entities`, especially `expandable_blockquote`, instead
  of raw HTML. This is intentional.
- Do not switch hidden thinking back to raw HTML `<blockquote expandable>` unless
  you test Telegram hidden-thinking replies end to end.
- The old HTML helpers are retained only for fallback/reference. They previously
  caused clients to show only `Thinking` / `Thought` or hide the final reply.

## Memory System Invariants

- `GEMINI.md` is manual-only. Automatic summaries must not rewrite it.
- Automatic memories live under `memory-docs/` as editable Markdown files with a
  `MEMORY_META` JSON block.
- The old cloud `pending/approved` model is retired as a source of truth. It may
  be imported once, but new memory ingest should not write more old entries.
- Model-readable memory is compiled into `INDEPENDENT_MEMORY.md`.
- Private memory and trash are not model-readable.
- Copies into `long_term` or `private` must create independent records. Editing
  the copy must never update the source.
- Editing a small summary only changes that small summary. If it is later merged
  into a large summary, the merge must use the edited current text.
- Editing a large summary only changes that large summary.

## Summary Lifecycle

- Small summaries are generated from raw chat history in 15-message batches.
- The Telegram bridge does not ingest after every idle pause. It waits for 10
  completed user/assistant turns, then a 2-minute idle window.
- Large-summary consolidation starts when there are 16 active small summaries.
- The oldest 15 small summaries become one large summary. The newest small
  summary remains active for the next cycle.
- Do not move small summaries to trash unless the large summary has actually
  been created, or the same generation signature is already known.
- Trash retention is 180 days from `trashedAt`.

## Local Tools

- New independent memory editor:
  `start-independent-memory-manager.cmd`, then open `http://127.0.0.1:4142/`.
- Old cloud import:
  `node legacy-cloud-memory-migration.cjs --force` if you need to rerun the
  one-time import from old `approvedEntries` / `pendingEntries`.
- Old cloud `memory.html` still uses the previous pending/approved model. Do not
  treat it as the source of truth for the new file-based memory workflow.

## Before Finishing Changes

Run syntax checks for touched scripts:

```bash
node --check telegram-gem-bridge.cjs
node --check memory-ingest.cjs
node --check independent-memory-store.cjs
node --check shared-memory-sync.cjs
node --check independent-memory-manager.cjs
node --check legacy-cloud-memory-migration.cjs
```

If a change touches Telegram thinking delivery, also manually test:

- hidden thinking
- visible thinking
- streaming reply finalization
- normal replies with no thinking block
