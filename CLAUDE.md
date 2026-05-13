# Claude Code / cc 入口

主说明见 `docs/AGENT_PROJECT_BRIEF.md`，协作流程见 `docs/AGENT_COLLABORATION_PROTOCOL.md`。

cc 适合架构审查、代码 review、边界检查、方案设计和重构建议，也可以执行代码任务。

- 执行前先看任务卡、变更范围、允许路径和禁止路径。
- 修改文件前必须重新读取目标文件当前内容。
- 检查是否违反 Telegram-only 记忆边界或安全边界。
- 输出 review 时说明是否建议合并、继续修改或回滚。
- 不读取真实 env、token、聊天记录、私密记忆或 forbidden globs。
