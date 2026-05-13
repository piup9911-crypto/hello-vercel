# Agent Project Brief

## 项目实际用途

`hello-vercel` 现在是一个个人 Vercel 工具入口和轻量控制台，不只是“第一个 Vercel 网站”。它包含 Supabase 登录与个人页面、共享记忆相关页面、Gem / Codex 状态舱、远程命令队列入口，以及一份可公开的本机 Telegram / Gemini / OpenAI compatible bridge 工具代码。

网页和 Vercel API 只负责展示、认证、状态存储和命令排队；真实 Telegram bridge、Gemini CLI bridge、OpenAI compatible bridge 和独立记忆系统运行在用户本机。

## 目录结构

- `api/`：Vercel API、Supabase REST 调用、共享记忆、状态上报和控制命令队列。
- `supabase/`：数据库结构、RLS 和初始化 SQL。
- `shared/`：共享前端认证和页面逻辑。
- `tools/gemini-cli-telegram/`：本机 Telegram bridge、Gemini CLI bridge、OpenAI compatible bridge、Telegram-only 独立记忆系统和公开模板。
- 根目录 HTML：状态页、记忆页、管理页、小站页面和登录入口。
- `backend-cockpit.html`：只读 Bug Triage Cockpit，用症状映射优先读取文件和 prompt pack。
- `docs/BUG_TRIAGE_MAP.json`：手写 / 半手写排错地图，不由全仓库扫描生成。
- `docs/`：项目说明、协作协议和模板。
- `agent-state/`：计划、任务卡、交接、review、临时锁说明和非敏感本地记录入口。

## 最重要的系统边界

- Telegram 云端记忆和独立记忆目前只服务 Telegram bridge。
- 普通 Gemini CLI 不接入 Telegram bridge 的记忆系统。
- 不要恢复 `memory-ingest.cjs --source cli`。
- 不要把 `INDEPENDENT_MEMORY.md` 同步到普通 `gemini-test` 工作区。
- `GEMINI.md` 是手动人格 / 项目上下文层，自动摘要或自动记忆不得改写它。
- 如果未来普通 Gemini CLI 也要记忆，必须另建独立系统，不复用 Telegram bridge 记忆。
- 不要修改 API 行为、Supabase schema 或 Vercel 配置，除非任务卡明确允许。

## 安全边界

不要提交或复制真实 token、cookie、Supabase service role key、Telegram bot token、真实聊天记录、私密记忆或本机 env。不要把这些内容写入任务卡、交接、review、README 或日志。

默认禁止读取、禁止修改、禁止纳入 agent 上下文：

- `tools/gemini-cli-telegram/bridge-state/**`
- `tools/gemini-cli-telegram/bridge-home/**`
- `tools/gemini-cli-telegram/bridge-workspace/INDEPENDENT_MEMORY.md`
- `tools/gemini-cli-telegram/memory-docs/private/**`
- `tools/gemini-cli-telegram/memory-docs/trash/**`
- `tools/gemini-cli-telegram/bridge.env`
- `**/*.env`
- `**/*token*`
- `**/*secret*`

例外：`tools/gemini-cli-telegram/bridge.env.example` 是公开模板，可以读取；真实 `bridge.env` 不可以读取。

## 改动风险分区

可以较大胆改：

- `docs/**`
- `agent-state/README.md`
- `agent-state/plans/**`
- `agent-state/tasks/**`
- `agent-state/handoffs/**`
- `agent-state/reviews/**`
- `tools/agent-*.cjs`
- 根 README 和协作入口文件

需要谨慎改：

- `api/**`
- `shared/**`
- 根目录 HTML 页面
- `tools/gemini-cli-telegram/*.cjs`
- `tools/gemini-cli-telegram/*.cmd`
- `supabase/schema.sql`
- `vercel.json`

默认不能读、不能改：

- 上方 forbidden globs
- 真实运行状态目录
- 真实聊天记录
- 私密记忆和 trash
- 真实密钥和 env

## 推荐验证命令

只改文档时：

```cmd
git diff --check
```

新增或修改 agent 辅助脚本时：

```cmd
node --check tools/agent-new-task.cjs
node --check tools/agent-new-plan.cjs
node --check tools/agent-new-handoff.cjs
node --check tools/agent-new-review.cjs
node --check tools/agent-check-state.cjs
node tools/agent-check-state.cjs
```

修改 `.cjs` / `.mjs` 时，对所有新增或修改的脚本运行 `node --check`。如果没有修改 `.mjs`，不要为了检查而触碰 API 文件。

不要在普通协作文档任务中启动真实 Telegram bridge、读取真实聊天、读取真实记忆或访问真实 env。

## Agent 协作原则

- 先读本文件和任务卡，再行动。
- 开工前读取当前 active plan；如果没有 plan，复杂任务先建立 plan。
- AI 完成某项工作后只能标记为 `pending_human_confirmation`，需要人类确认后才把该项打勾为完成。
- 按“能力声明 + 当前任务需要”协作，不固定死 Codex / cc / gem 的职责。
- 实现前确认当前文件状态、允许路径和禁止路径。
- 修改目标文件前，重新读取目标文件当前内容。
- 发现锁或冲突时先停下，不强行覆盖。
- 交接和 review 必须说明已做、未做、风险、验证和回滚范围。
- 输出最终结果时区分新增文件、修改文件、未触碰文件、没有做的事、检查命令和需要人工确认的问题。
