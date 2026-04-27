# Memory System Overview

This document explains the current memory architecture for the
`gemini-cli-telegram` project.

It is written mainly for two collaborators:

- the local human maintainer
- the Gemini CLI side that may continue editing this code later

For the short "do not accidentally break this" checklist, read
`MAINTAINER_GUARDRAILS.md` first.

## Design Goal

The system now treats memory as editable text documents instead of auto-writing
everything into `GEMINI.md`.

Two important rules now apply:

1. `GEMINI.md` remains manual-only.
2. Auto-generated memories live in a separate independent memory system.
3. The old cloud `pending/approved` model is no longer a second source of truth.

## Read Model

The model should read:

- `GEMINI.md`
- independent memory documents that are marked readable

The model should **not** read:

- private memory
- trash

## Independent Memory Regions

Independent memory is stored under:

- `memory-docs/small-summaries`
- `memory-docs/large-summaries`
- `memory-docs/long-term`
- `memory-docs/private`
- `memory-docs/trash`

Each memory document is an independent text file.

This is important:

- memories in different regions do **not** synchronize
- copying a memory into another region creates a new independent memory record
- editing one memory never auto-updates another memory

## Current Automation Rules

### Small summaries

- `15 raw chat messages -> 1 small summary`
- small summaries are generated from CLI or Telegram chat history
- they are saved as separate text documents
- on the Telegram bridge, memory ingest is no longer scheduled after every
  idle pause
- the bridge now waits until there have been `10 completed user/assistant
  turns`, then requires the normal `2 minute idle window` before it triggers
  the ingest script

### Large summaries

- once there are `16` active small summaries
- the oldest `15` are summarized into `1` new large summary
- those `15` old small summaries are moved into trash
- the newest remaining small summary stays active

### Trash retention

- trash deletion is based on `trashedAt`
- trash auto-deletes after `180 days`

## Why This Is More Stable

We intentionally do **not** auto-write summaries into `GEMINI.md`.

Reason:

- `GEMINI.md` is the stable manual layer
- summaries are the flexible auto layer
- combining both by rewriting md created coupling and made debugging harder

We also intentionally avoid cross-memory synchronization.

Reason:

- the user may rewrite the same idea differently depending on region and mood
- therefore the system must treat each copied memory as a separate text record

## File Format

Each independent memory file uses a simple text format:

- a JSON metadata block in an HTML comment
- followed by the actual editable text body

This keeps the content human-readable while still preserving lifecycle metadata.

## Main Files

### `independent-memory-manager.cjs`

Responsibilities:

- provide a local HTTP API for listing and editing independent memory files
- provide clone actions into `long_term` and `private`
- move records into trash or permanently delete them
- rebuild the model-readable independent memory docs after each mutation

### `independent-memory-manager.html`

Responsibilities:

- act as the local editor UI for the new memory regions
- edit small summaries, large summaries, long-term memory, private memory, and trash
- keep each region as explicitly separate editable text instead of pretending they are linked records

### `memory-ingest.cjs`

Responsibilities:

- read raw CLI / Telegram chat history
- create small summaries
- create large summaries when enough small summaries exist
- move merged small summaries into trash
- clean up expired trash

### `independent-memory-store.cjs`

Responsibilities:

- define the memory directory structure
- create / read / update memory files
- clone records into other regions when needed later
- move records into trash
- maintain generation signatures to prevent duplicate large summaries

### `shared-memory-sync.cjs`

Responsibilities:

- no longer writes summaries into `GEMINI.md`
- runs a one-time legacy cloud import when old shared-memory credentials exist
- compiles model-readable independent memory text
- writes `INDEPENDENT_MEMORY.md` into the CLI and Telegram workspaces
- generates a CLI bootstrap prompt file

### `legacy-cloud-memory-migration.cjs`

Responsibilities:

- import the old cloud `approvedEntries` into `long_term`
- import the old plain shared-memory `content` into `long_term`
- import the old cloud `pendingEntries` into `private` by default, so they are
  preserved but not model-readable
- skip duplicates by legacy key and content hash

This is a bridge for retiring the old system, not a new ongoing write path.

### `start-gemini-cli-with-memory.cjs`

Responsibilities:

- run CLI-side memory ingest
- rebuild independent memory documents
- launch interactive Gemini CLI with a bootstrap prompt so the independent
  memory layer is read without mutating `GEMINI.md`

## Current Limits / Follow-ups

This version now includes a local editor and API for the new independent memory
directories.

The old cloud `memory.html` page is still based on the previous
`pending/approved` model, so it should not be treated as the source of truth for
the new independent memory workflow. It exists only as legacy data until the new
memory page replaces it.

Use the local manager instead:

- start with `start-independent-memory-manager.cmd`
- open `http://127.0.0.1:4142`

Still not implemented yet:

- restore helpers from trash back into active summary regions
- the future cloud/web syncing story for this new file-based memory layout

## Collaboration Note

When editing this subsystem later, keep these principles:

- do not restore automatic summary writes into `GEMINI.md`
- do not restore new writes into the old `pending/approved` cloud model
- do not add hidden coupling between memories in different regions
- prefer explicit file lifecycle steps over implicit synchronization
- when adding UI or API behaviors, keep comments that explain why the memory
  regions are intentionally independent editable texts
