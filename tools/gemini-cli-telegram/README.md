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
- `gem-chat-record-manager.cjs` and `.html`: local Gem bridge chat record
  manager for Telegram/Gemini CLI context review, deletion, archive viewing,
  phone preview, and scroll-date navigation.
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

## Chat Record Manager

The chat record manager is a local agent, not a pure Vercel page. It reads and
writes files under `bridge-state/`, so it must run on the same computer as the
Telegram/Gem bridge.

Start it locally:

```bat
start-gem-chat-record-manager.cmd
```

Open it on the computer:

```text
http://127.0.0.1:4144/
```

If the service is started with `GEM_CHAT_RECORD_MANAGER_HOST=0.0.0.0`, devices
on the same trusted Wi-Fi can open it through the computer LAN IP, for example:

```text
http://192.168.101.8:4144/
```

See `docs/gem-chat-record-manager.md` for the data rules and UI behavior.
