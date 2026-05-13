# Shared Memory Setup

这份文档说明 Vercel / Supabase 侧的共享记忆接口，以及它和本机 Telegram bridge 的当前边界。

## 当前边界

- Telegram 云端记忆和独立记忆目前只服务 Telegram bridge。
- 普通 Gemini CLI 不接入 Telegram bridge 的记忆系统。
- 不要恢复 `memory-ingest.cjs --source cli`。
- 不要把 `INDEPENDENT_MEMORY.md` 同步到普通 `gemini-test` 工作区。
- `GEMINI.md` 是手动人格 / 项目上下文层，自动摘要或自动记忆不得改写它。
- 如果未来普通 Gemini CLI 也要记忆，必须另建独立系统，不要复用 Telegram bridge 记忆。

旧说法中关于 “Gemini CLI / Telegram 共用共享记忆”、`memory-ingest.cjs` 扫描 CLI 对话、`shared-memory-sync.cjs` 为普通 CLI 生成 `GEMINI.md` 的内容已经废弃。

## 组成部分

云端侧仍包含这些公开仓库文件：

- `supabase/schema.sql` 里的 `public.agent_shared_memory`
- `supabase/schema.sql` 里的 `public.agent_memory_entries`
- `api/shared-memory.mjs`
- `api/memory-entries.mjs`
- `memory.html`

本机 Telegram bridge 侧的当前实现见：

- `tools/gemini-cli-telegram/MEMORY_SYSTEM_OVERVIEW.md`
- `tools/gemini-cli-telegram/MAINTAINER_GUARDRAILS.md`
- `tools/gemini-cli-telegram/README.md`

## 需要的 Vercel 环境变量

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEMORY_SYNC_TOKEN`

说明：

- `SUPABASE_SERVICE_ROLE_KEY` 只给服务端 API 用，不能放到前端页面或仓库。
- `MEMORY_SYNC_TOKEN` 是本机 Telegram bridge / 本机同步器调用云端记忆 API 时用的密钥。
- 不要把真实 token、cookie、service role key 或 `bridge.env` 内容写进仓库、任务卡、交接记录或日志。

## 页面和 API 的作用

- `memory.html`：登录后手动查看和整理云端记忆相关内容。
- `api/shared-memory.mjs`：浏览器登录态和本机同步器都可访问的共享记忆入口。
- `api/memory-entries.mjs`：记忆条目的读取、写入和审核入口。

`api/shared-memory.mjs` 会过滤 `private` 和 `trash` 区段，避免这些内容进入模型可读结果。文件型独立记忆的新 source of truth 在本机 `tools/gemini-cli-telegram/memory-docs/`，但其中私密区和垃圾箱默认不能读、不能提交、不能复制到 agent 文档。

## 本机桥接器配置

真实配置写在本机 `tools/gemini-cli-telegram/bridge.env`，该文件禁止提交和默认读取。公开仓库只保留模板：

```text
tools/gemini-cli-telegram/bridge.env.example
```

`bridge.env.example` 可以读取，因为它不包含真实密钥；真实 `bridge.env` 不可以读取。

## 推荐验证

如果只改本文档，不需要运行真实 bridge，也不要读取真实聊天或真实记忆目录。

如果未来修改 Telegram 记忆系统，应至少在 `tools/gemini-cli-telegram/` 下运行语法检查，并人工确认：

```cmd
node --check memory-ingest.cjs
node --check shared-memory-sync.cjs
node --check telegram-gem-bridge.cjs
```

需要行为验证时，先确认任务卡允许范围；不要把 `bridge-state/chats/`、私密记忆或真实 env 纳入默认上下文。
