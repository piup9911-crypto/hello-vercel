# Gem Bridge Chat Record Manager

## Purpose

This manager handles local Gem bridge chat records. It is not the official
Telegram chat history and it is separate from the independent memory system.

The manager exists for two jobs:

- Save and inspect the chat records that Gem bridge can feed back into Gemini.
- Permanently delete selected local context records when a bad reply, leaked
  thinking text, or corrupted message should stop affecting the model.
- Archive a whole chat window, similar to the ChatGPT left sidebar archive
  behavior.
- Separate Telegram bridge display records from Gemini CLI session archives.
- Preview the mobile layout on desktop when a phone cannot reach the LAN page.

## Scope

Managed file:

```text
bridge-state\chats\<chatId>.json
```

Archived windows:

```text
bridge-state\chat-archives\<chatId>\archive-YYYYMMDD-HHMMSS.json
```

Imported Gemini CLI sessions can also appear as archived windows. Telegram
bridge sessions are merged into the Telegram display window; Gemini CLI-only
sessions stay under the Gem CLI archive group.

Out of scope for this version:

- Telegram app message deletion.
- `INDEPENDENT_MEMORY.md` edits.
- Automatic upload or automatic down-sync.
- Public tunnel access by default.
- Codex bridge chat records.

## Local Panel

Start the panel with:

```powershell
.\start-gem-chat-record-manager.cmd
```

Open:

```text
http://127.0.0.1:4144
```

If you want another device on the same trusted Wi-Fi to open it, start the
server with:

```text
GEM_CHAT_RECORD_MANAGER_HOST=0.0.0.0
```

Then open the computer LAN address, for example:

```text
http://192.168.101.8:4144
```

Do not expose this panel to the public internet without authentication. It can
delete local chat records.

The panel provides:

- A ChatGPT-style left chat list.
- A Telegram current display window that merges current Telegram bridge records
  with old Telegram bridge sessions.
- A Gem CLI archive group for local CLI session records.
- Full message display for the selected chat.
- Date dividers between messages.
- A Xiaomi-gallery-style floating date rail that appears while scrolling.
- A desktop phone preview mode for checking the mobile layout.
- Permanent deletion for selected messages.
- Archive current window.
- Delete archived window.
- JSON export for manual backup or later cloud upload.

## Deletion Rules

Deletion is permanent for the selected managed window. Deleted messages are
removed from that window after a backup is written.

When deleting from the merged Telegram display window, the manager deletes from
the underlying active chat file and/or Telegram session archive file that owns
the selected message. Active-chat edits reset `sessionId`; archive-only edits do
not affect the active Gemini CLI session.

## Window Archive Rules

Archive is window-level, not message-level. When the current window is archived:

1. The active chat JSON is backed up.
2. The current `history` is copied into a timestamped archive file.
3. The active chat JSON is reset to an empty new window.
4. The old window appears under the archived group in the left sidebar.

Archived windows are no longer read by Gem bridge as the active model context.
They remain visible in the manager and can be exported or permanently deleted.

Every write creates a timestamped backup next to the original chat JSON before
modifying the file.

## Why SessionId Is Reset

Gem bridge uses Gemini CLI `--resume <sessionId>` for continuing a conversation.
If a message is deleted or archived only in the local JSON, the old Gemini CLI
session may still contain that message in its private cache.

For that reason, active-window delete and window-archive operations set:

```json
"sessionId": null
```

The next Gem reply starts a fresh Gemini CLI session while retaining the cleaned
local active history and independent memory files.

## Relationship To Memory

This system is separate from the independent memory system. It does not read or
write these files:

```text
bridge-workspace\INDEPENDENT_MEMORY.md
C:\Users\yx\gemini-test\INDEPENDENT_MEMORY.md
memory-docs\generated\independent-memory.md
```

Deleting a chat record only changes what the bridge can use as local chat
context. It does not erase long-term memory.

## Future Cloud Version

The local manager is designed so it can later sit behind a tunnel such as
Cloudflare Tunnel. A future cloud version can add:

- Manual upload from local JSON to cloud storage.
- Manual apply from cloud storage back to local JSON.
- A public URL protected by a write token.
- A diff preview before applying cloud edits locally.

For the first version, public forwarding is intentionally left disabled.
