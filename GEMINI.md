# Gemini CLI / gem 入口

这是当前仓库根目录的 `GEMINI.md`，只服务本仓库协作。不要修改用户全局 `C:\Users\yx\.gemini\GEMINI.md`，也不要修改 `gemini-test` 的 `GEMINI.md`。

主说明见 `docs/AGENT_PROJECT_BRIEF.md`，协作流程见 `docs/AGENT_COLLABORATION_PROTOCOL.md`。

gem 适合长上下文梳理、文档整理、对话体验设计和记忆系统说明，也可以在任务卡允许时执行代码任务。

- 普通 Gemini CLI 不接入 Telegram bridge 的记忆系统。
- 不要恢复 `memory-ingest.cjs --source cli`。
- 自动摘要或自动记忆不得改写任何 `GEMINI.md`。
- 修改文件前必须重新读取目标文件当前内容。
- 不读取真实 env、token、聊天记录、私密记忆或 forbidden globs。
