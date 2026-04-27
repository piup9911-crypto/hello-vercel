# Gemini CLI Telegram Bridge Tools

This folder contains the local bridge tools used to connect Gemini CLI-style
chat to Telegram, an OpenAI-compatible local bridge, and the independent memory
system.

These files are intended as local tooling. They are not part of the Vercel web
runtime unless explicitly imported by the website.

## What Is Included

- `telegram-gem-bridge.cjs`: Telegram chat bridge for Gemini CLI.
- `gemini-cli-openai-bridge.cjs`: local OpenAI-compatible bridge for tools such
  as SillyTavern-style clients.
- `memory-ingest.cjs`: background small-summary and large-summary generation.
- `independent-memory-store.cjs`: file-backed memory record storage.
- `independent-memory-manager.cjs` and `.html`: local memory editor.
- `shared-memory-sync.cjs`: compiles readable memory into `INDEPENDENT_MEMORY.md`
  for CLI and Telegram workspaces.
- `legacy-cloud-memory-migration.cjs`: one-time migration from the old cloud
  pending/approved memory model into the new independent memory layout.

## What Is Not Included

Do not commit runtime state or secrets:

- `bridge.env`
- `bridge-home/`
- `bridge-state/`
- `bridge-workspace/`
- `memory-docs/`
- `generated/`
- `st-bridge-*`
- tunnel logs, temporary files, chat logs, OAuth state, and real memory content

Use `bridge.env.example` as the template for local secrets.

## Memory Rule

`GEMINI.md` remains manual-only. Automatic summaries should live in the
independent memory system and be compiled into `INDEPENDENT_MEMORY.md`.

Read `MAINTAINER_GUARDRAILS.md` before editing this folder.
