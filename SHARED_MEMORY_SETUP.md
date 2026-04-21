# Shared Memory Setup

这套共享记忆现在由三部分组成：

- `supabase/schema.sql` 里的 `public.agent_shared_memory`
- `api/shared-memory.mjs`
- `memory.html`

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
  登录后手动编辑这份共享记忆。
- `api/shared-memory.mjs`
  浏览器登录态和本地同步脚本都走这个入口。

## 本地桥接器需要的配置

把这些值写到 `bridge.env`：

```env
SHARED_MEMORY_URL=https://hello-vercel-blush-eight.vercel.app/api/shared-memory
SHARED_MEMORY_SYNC_TOKEN=replace-this-with-the-same-token-you-set-in-vercel
```

## Gemini CLI 启动方式

当前工作区里已经新增：

- `shared-memory-sync.cjs`
- `start-shared-memory-gemini.cmd`

这个启动脚本会先拉云端共享记忆，再进入 `C:\Users\yx\gemini-test` 启动 Gemini CLI。
