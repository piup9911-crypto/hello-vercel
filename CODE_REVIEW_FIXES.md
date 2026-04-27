# Code Review Fixes — 2026-04-24

> **Reviewer**: Pyrite (烬)
> **Project**: [hello-vercel](https://github.com/piup9911-crypto/hello-vercel)
> **Date**: 2026-04-24
> **Scope**: Full codebase review — 14 source files, 7 bugs fixed

---

## Summary

A thorough code review was conducted across all source files in the project.
Seven bugs were identified and fixed, ranging from a critical data-integrity
issue (memory classification logic) to minor UI inconsistencies and dead code.

All fixes are marked with `[BUG-N FIX]` comments inline for easy `grep` lookup:

```bash
# 在项目根目录运行，快速定位所有修复位置
grep -rn "\[BUG-" --include="*.html" --include="*.js" --include="*.mjs"
```

---

## Fix Details

### 🔴 Bug 4 — `memory.html` — Memory kind classification logic error (HIGH)

**File**: `memory.html` (pendingList click handler, ~line 1092)

**Problem**: When approving a pending memory entry, `memoryKind` was mapped to
only two values: `"current_summary"` or `"long_term"`. The subsequent three-way
`nextMetaByKind` builder checked for `"important_event"`, but that branch was
**unreachable** because `memoryKind` could never equal `"important_event"`.
This caused all important-event entries to be incorrectly tagged with
`preference_memory` metadata upon approval.

**Fix**: Use the raw `card.dataset.entryKind` value directly (which already
stores the correct three-way classification from `getMemoryKind()`), removing
the lossy two-value mapping.

**Search tag**: `[BUG-4 FIX]`

---

### 🟡 Bug 2 — `magic.html` — Flip animation leaves residual transform (MEDIUM)

**File**: `magic.html` (~line 125)

**Problem**: The "flip" magic trick appended `rotateZ(360deg) scale(0.5)` to
the existing mouse-tracking transform string. After the 1-second animation,
the transition was restored but the **transform value was never reset**, leaving
the card permanently shrunk at 50% scale. Repeated triggers made the transform
string grow unboundedly.

**Fix**: Set a clean transform value instead of appending. After the animation
completes (1s timeout), reset the transform to a neutral `rotateY(0) rotateX(0)`
so the mouse-tracking `mousemove` handler can take over cleanly on the next
frame.

**Search tag**: `[BUG-2 FIX]`

---

### 🟡 Bug 3 — `magic.html` — Particle coordinates and click filter (MEDIUM)

**File**: `magic.html` (~line 138)

**Problem**: Two issues:
1. The click-to-sparkle handler only excluded `<a>` tags but not `<button>`.
   The inline comment said "点按钮不要放烟花" but the code didn't match.
2. Particle positions used `e.clientX / e.clientY` (viewport coords) but
   particles are absolutely positioned in the document, causing offset when
   the page is scrolled.

**Fix**:
1. Added `button` to the excluded tag list.
2. Changed to `e.pageX / e.pageY` to match `position: absolute` positioning.

**Search tag**: `[BUG-3 FIX]`

---

### 🟡 Bug 5 — `memory.html` — Save button text switches to English (MEDIUM)

**File**: `memory.html` (~line 915, 943)

**Problem**: The save button's text was set to English strings (`"Saving..."` and
`"Save Manual Shared Memory"`) in JavaScript, while the HTML defined it in
Chinese (`保存手动共享记忆`). After a save attempt, the button permanently
displayed English text.

**Fix**: Changed both JS strings to Chinese (`"正在保存..."` and `"保存手动共享记忆"`).

**Search tag**: `[BUG-5 FIX]`

---

### 🟢 Bug 6 — `index.html` — Signout error invisible to user (LOW)

**File**: `index.html` (~line 585-592)

**Problem**: If `signOut()` threw an error, the error message was written to the
`#feedback` element which lives inside `#guest-view`. But during signout, the
user is viewing `#member-view` while `#guest-view` is `hidden`, so the error
message was invisible.

**Fix**: Changed to `window.alert()` to ensure the user sees the error regardless
of which view is active.

**Search tag**: `[BUG-6 FIX]`

---

### 🟢 Bug 7 — `shared/notion-app.js` — Missing AppAuth guard in catch (LOW)

**File**: `shared/notion-app.js` (~line 886)

**Problem**: The boot error handler had a conditional guard for `authEmail` text
(`window.AppAuth ? ... : fallback`) but the `window.alert()` call on the next
line called `window.AppAuth.humanizeError()` unconditionally. If `supabase-auth.js`
failed to load (CDN down), this would throw `TypeError: Cannot read properties
of undefined`.

**Fix**: Extract the guarded error message into a variable and reuse it in both
places.

**Search tag**: `[BUG-7 FIX]`

---

### 🟢 Bug 1 — `secret-diary.html` — Dead legacy script block (LOW)

**File**: `secret-diary.html` (lines 562-912, ~350 lines)

**Problem**: A `<script type="text/plain">` block containing the entire legacy
localStorage-based diary logic was left in the HTML. Since `type="text/plain"`
scripts are never executed by the browser, this was pure dead weight (~12KB) that
added no functionality but could confuse future maintainers.

**Fix**: Removed the entire block and replaced it with an HTML comment explaining
the removal and pointing to Git history for reference.

**Search tag**: `[BUG-1 FIX]`

---

## Additional Notes for Gemini CLI / Codex

### Architecture Overview

```
hello-vercel/
├── index.html              # Landing page + Supabase login form
├── login.html              # Legacy login redirect (→ index.html)
├── notion.html             # Mini Notion editor (Editor.js + cloud sync)
├── secret-diary.html       # Private diary with mood/mode tags
├── memory.html             # Shared memory console (pending/approved)
├── magic.html              # Fun interactive particle playground
├── shared/
│   ├── supabase-auth.js    # Unified auth wrapper (IIFE)
│   ├── notion-app.js       # Mini Notion cloud logic (IIFE)
│   └── secret-diary-app.js # Secret diary cloud logic (IIFE)
├── api/
│   ├── _memory-shared.mjs  # Shared helpers (Supabase REST, auth, CRUD)
│   ├── memory-entries.mjs  # GET/POST/PATCH pending/approved memory entries
│   ├── shared-memory.mjs   # GET/PUT manual shared memory + bundle
│   └── supabase-config.mjs # GET public Supabase URL + anon key
└── supabase/
    └── schema.sql          # Full schema with RLS policies
```

### Key Patterns

- **Auth flow**: `supabase-auth.js` provides `window.AppAuth` with `requireUser()`,
  `signInWithPassword()`, `signOut()`, `humanizeError()`. Pages that need auth
  call `requireUser()` which auto-redirects to `index.html?returnTo=...` if not
  logged in.

- **Data sync**: Both Mini Notion and Secret Diary use a `scheduleSync()` /
  `flushPendingSync()` debounce pattern (600ms) to batch rapid edits into single
  cloud writes.

- **Memory system**: Uses a two-tier model:
  - `agent_shared_memory` — single manual text blob (key: "primary")
  - `agent_memory_entries` — individual entries with `pending → approved/edited/rejected`
    lifecycle and metadata tags (`memoryKind`, `timeScope`, `eventStatus`, `retention`)

- **Security**: All user tables enforce Row-Level Security with `auth.uid() = user_id`.
  API endpoints validate Bearer tokens against Supabase `/auth/v1/user` or a
  `MEMORY_SYNC_TOKEN` header for CLI/bot access.

### Known Remaining Issues (not fixed)

1. **API endpoints lack CORS headers** — Only matters if cross-origin access is
   needed (e.g., from a different domain's Telegram bot).
2. **`agent_memory_entries` missing DELETE RLS policy** — The table has
   SELECT/INSERT/UPDATE but no DELETE policy.
3. **`magic.html` spawns 40 DOM particles per click** — Could cause jank on
   low-end devices with rapid clicking; consider Canvas rendering or particle cap.

---

## Files Modified

| File | Change |
|------|--------|
| `memory.html` | Bug 4 (memoryKind logic), Bug 5 (Chinese button text) |
| `magic.html` | Bug 2 (flip transform), Bug 3 (particle coords + click filter) |
| `index.html` | Bug 6 (signout error visibility) |
| `shared/notion-app.js` | Bug 7 (AppAuth guard in catch) |
| `secret-diary.html` | Bug 1 (removed ~350 lines of dead code) |
