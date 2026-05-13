# Agent Collaboration Protocol

这套协议用于 Codex、Claude Code / cc、Gemini CLI / gem、Telegram 侧 agent 和人类协作。它不固定岗位，只要求每个参与者声明能力、当前模式、范围和交接状态。

## 基础概念

`agentId` 可选值：

- `codex`
- `cc`
- `gem`
- `telegram-gem`
- `human`
- `other`

`participationMode` 可选值：

- `implement`
- `review`
- `research`
- `summarize`
- `debug`
- `design`
- `test`
- `document`
- `observe`

任务状态可选值：

- `proposed`
- `planned`
- `claimed`
- `running`
- `blocked`
- `needs_review`
- `revised`
- `done`
- `abandoned`

计划步骤状态可选值：

- `todo`
- `in_progress`
- `pending_human_confirmation`
- `confirmed_done`
- `blocked`
- `skipped`

## 协作 Plan

复杂任务必须先建立 plan。plan 放在 `agent-state/plans/`，用于人类、Codex、cc、gem 和未来后端可视化面板共享当前工作状态。

其他 agent 开工前必须读取当前 active plan；如果 plan 已经过期、缺失或和任务卡冲突，先停下并向人类确认，不要直接改文件。

Plan 规则：

1. 每个 plan 必须包含 `id`、`title`、`status`、`createdAt`、`createdBy`、`owners`、`relatedTasks`、`steps`、`humanConfirmationRequired`、`backendVisualizationNotes`。
2. 每个 step 必须包含 `id`、`title`、`owner`、`status`、`evidence`、`humanConfirmedBy`、`humanConfirmedAt`。
3. AI 完成某个 step 后，只能把状态改为 `pending_human_confirmation`，并写明 evidence。
4. 只有人类确认后，才能把 step 打勾为 `confirmed_done`。
5. 如果 step 影响业务代码、API、schema、部署配置或记忆系统，必须在 evidence 里写清楚验证和回滚范围。
6. 后端可视化可以读取 plan 和 agent-state 摘要，但不得读取 forbidden globs、真实 env、真实聊天或私密记忆。

## 任务卡要求

每张任务卡必须包含：

- `id`
- `title`
- `createdAt`
- `createdBy`
- `currentOwner`
- `participants`
- `goal`
- `nonGoals`
- `contextFiles`
- `allowedPaths`
- `forbiddenPaths`
- `expectedOutputs`
- `verification`
- `risks`
- `handoffNotes`
- `reviewNotes`
- `status`

任务卡放在 `agent-state/tasks/`。任务卡不得包含 token、真实聊天记录、私密记忆、真实 env 或 forbidden globs 内容。

## 实现前确认

agent 在修改任何文件前必须：

1. 读取任务卡和 `docs/AGENT_PROJECT_BRIEF.md`。
2. 读取当前 active plan；复杂任务没有 plan 时先建立 plan。
3. 检查 `agent-state/locks/` 是否已有相关锁。
4. 确认 `allowedPaths` 和 `forbiddenPaths`。
5. 重新读取将要修改的目标文件当前内容。
6. 确认本次改动不需要读取真实 env、真实聊天、真实记忆或 token。

不允许只凭旧上下文直接改文件。

## Forbidden Globs

以下路径默认禁止读取、禁止修改、禁止纳入 agent 上下文：

- `tools/gemini-cli-telegram/bridge-state/**`
- `tools/gemini-cli-telegram/bridge-home/**`
- `tools/gemini-cli-telegram/bridge-workspace/INDEPENDENT_MEMORY.md`
- `tools/gemini-cli-telegram/memory-docs/private/**`
- `tools/gemini-cli-telegram/memory-docs/trash/**`
- `tools/gemini-cli-telegram/bridge.env`
- `**/*.env`
- `**/*token*`
- `**/*secret*`

`tools/gemini-cli-telegram/bridge.env.example` 是允许读取的公开模板；真实 `bridge.env` 禁止读取。

除非人类明确指定，否则 agent 默认不得读取这些路径。即使读取失败，也不能尝试绕过。不得把这些路径里的内容复制到任务卡、交接记录、review、README 或日志中。

## 交接要求

每次交接必须包含：

- 做了什么
- 没做什么
- 哪些文件改了
- 哪些地方不确定
- 下一位 agent 应该从哪里继续
- 需要人工决定的问题
- `rollbackNotes`

`rollbackNotes` 要写清楚：如果这次改错了，应该回滚哪些文件，哪些文件只是文档 / 模板改动，是否涉及业务代码、API、schema 或配置。

交接记录放在 `agent-state/handoffs/`。

## Review 要求

每次 review 必须包含：

- 是否符合任务目标
- 是否违反边界
- 是否有安全风险
- 是否需要运行测试
- 是否建议合并、继续修改或回滚
- `rollbackNotes`

review 记录放在 `agent-state/reviews/`。review 不应粘贴敏感内容，只记录结论、文件路径和可复验的非敏感证据。

## 轻量文件锁

1. agent 准备修改文件前，应先查看是否已有相关锁。
2. 锁文件命名建议：
   - `path__to__file.ext.lock`
   - `taskId.agentId.lock`
3. 锁文件内容包含：
   - `agentId`
   - `taskId`
   - `lockedPaths`
   - `reason`
   - `createdAt`
   - `expiresAt`
4. 锁不是复杂并发系统，只是提醒其他 agent 不要同时改同一块。
5. 锁文件默认不提交入库。
6. 如果锁过期，可以接手，但必须写 handoff 或 review 说明。
7. 如果发现冲突，先停下，不要强行覆盖。

## 辅助脚本限制

`tools/agent-new-plan.cjs`、`tools/agent-new-task.cjs`、`tools/agent-new-handoff.cjs`、`tools/agent-new-review.cjs`、`tools/agent-check-state.cjs` 只能写入或读取 `agent-state/` 内部允许的计划、任务、交接、review 和锁状态。

这些脚本不能扫描业务文件，不能读取 env，不能启动 bridge，不能访问网络，不能读取 forbidden globs。模板必须默认包含 forbiddenPaths 和敏感信息提醒。

## 最终输出格式

完成任务后按这个格式输出：

- 新增文件
- 修改文件
- 未触碰文件
- 没有做的事
- 检查命令
- 需要人工确认的问题

`未触碰文件` 不需要枚举整个仓库，只列关键禁止触碰或明确未改的文件和系统。
