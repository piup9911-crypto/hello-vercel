# hello-vercel

这是一个部署在 Vercel 上的个人工具入口和轻量控制台。它包含小站页面、Supabase 登录与数据页、共享记忆审核页，以及 Gem / Codex / Telegram 桥接相关的状态与控制入口。

## 主要模块

- `api/`：Vercel API、Supabase 读写、状态上报和命令队列接口。
- `shared/`：前端共享认证和页面逻辑。
- `supabase/`：数据库初始化 SQL 和 RLS 策略。
- `tools/gemini-cli-telegram/`：本机 Telegram bridge、Gemini CLI bridge、OpenAI compatible bridge，以及 Telegram-only 独立记忆系统。
- 根目录 HTML：登录页、状态页、记忆页、管理页和小站页面。
- `backend-cockpit.html`：只读 Bug Triage Cockpit，按症状定位优先读取文件和最小 agent prompt。

## Agent 协作入口

所有 agent 先读 [docs/AGENT_PROJECT_BRIEF.md](docs/AGENT_PROJECT_BRIEF.md)，再按 [docs/AGENT_COLLABORATION_PROTOCOL.md](docs/AGENT_COLLABORATION_PROTOCOL.md) 建任务卡、交接和 review。

- Codex 入口：[AGENTS.md](AGENTS.md)
- Claude Code / cc 入口：[CLAUDE.md](CLAUDE.md)
- Gemini CLI / gem 入口：[GEMINI.md](GEMINI.md)
- 协作计划模板：[docs/AGENT_PLAN_TEMPLATE.md](docs/AGENT_PLAN_TEMPLATE.md)
- 协作状态目录：[agent-state/](agent-state/)
- Bug 排查地图：[docs/BUG_TRIAGE_MAP.json](docs/BUG_TRIAGE_MAP.json)
- Bug Triage Cockpit：[backend-cockpit.html](backend-cockpit.html)

## 安全提醒

不要提交真实 token、cookie、Supabase service role key、Telegram bot token、真实聊天记录、私密记忆或本机 env。普通 Gemini CLI 不接入 Telegram bridge 的记忆系统；如果未来要给普通 Gemini CLI 做记忆，必须另建独立系统。

## 相关文档

- [Shared Memory Setup](SHARED_MEMORY_SETUP.md)
- [Supabase Setup](SUPABASE_SETUP.md)
- [Telegram bridge guardrails](tools/gemini-cli-telegram/MAINTAINER_GUARDRAILS.md)
- [Telegram-only memory overview](tools/gemini-cli-telegram/MEMORY_SYSTEM_OVERVIEW.md)
