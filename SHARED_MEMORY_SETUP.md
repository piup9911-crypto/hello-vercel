# Shared Memory Setup

这套共享记忆现在由三部分组成：

- `supabase/schema.sql` 里的 `public.agent_shared_memory`
- `supabase/schema.sql` 里的 `public.agent_memory_entries`
- `api/shared-memory.mjs`
- `api/memory-entries.mjs`
- `memory.html`

注意：

- 这次升级后，需要重新执行一次 [supabase/schema.sql](supabase/schema.sql)，因为新增了 `agent_memory_entries` 表。
- 网站代码改完以后，也需要重新部署到 Vercel，新的 API 和页面才会生效。

## 需要的 Vercel 环境变量

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEMORY_SYNC_TOKEN`

说明：

- `SUPABASE_SERVICE_ROLE_KEY` 只给服务端 API 用，不能放到前端页面。
- `MEMORY_SYNC_TOKEN` 是给本地 Telegram bridge / Gemini CLI 同步脚本调用 `/api/shared-memory` 时用的密钥。

## 页面和 API 的作用

- `memory.html`
  登录后手动编辑共享记忆，并审核模型自动提议的待确认记忆。
- `api/shared-memory.mjs`
  浏览器登录态和本地同步脚本都走这个入口，返回手动共享记忆和已确认记忆。
- `api/memory-entries.mjs`
  本地自动提议器把候选记忆写到这里，网页审核也走这个入口。

## 本地桥接器需要的配置

把这些值写到 `bridge.env`：

```env
SHARED_MEMORY_URL=https://hello-vercel-blush-eight.vercel.app/api/shared-memory
SHARED_MEMORY_SYNC_TOKEN=replace-this-with-the-same-token-you-set-in-vercel
```

## Gemini CLI 启动方式

当前工作区里已经新增：

- `cloud-memory-client.cjs`
- `shared-memory-sync.cjs`
- `memory-ingest.cjs`
- `start-shared-memory-gemini.cmd`

现在的本地流程是：

1. `memory-ingest.cjs`
   扫 CLI / Telegram 最近对话，自动提议待确认记忆。
2. `shared-memory-sync.cjs`
   拉取云端已确认记忆，编译成 CLI / Telegram 各自要吃的 `GEMINI.md`。
3. 再启动 Gemini CLI 或 Telegram bridge。
