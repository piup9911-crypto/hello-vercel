# Codex 入口

先读 `docs/AGENT_PROJECT_BRIEF.md`，再按 `docs/AGENT_COLLABORATION_PROTOCOL.md` 工作。

- 复杂任务先给 plan，并确认影响范围、允许路径和禁止路径。
- 修改文件前必须重新读取目标文件当前内容，不要只凭旧上下文改。
- 优先做小范围、可验证的改动；不要顺手重构无关业务。
- 实现后说明改动摘要、验证结果、未触碰的关键系统和回滚范围。
- 不读取真实 env、token、聊天记录、私密记忆或 forbidden globs。
