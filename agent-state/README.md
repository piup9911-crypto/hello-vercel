# agent-state

这个目录保存轻量 agent 协作状态。它只放非敏感任务信息，不放真实聊天记录、token、cookie、Supabase service role key、Telegram bot token、私密记忆、真实 env 或数据库密钥。

## 目录用途

- `plans/`：协作计划，记录步骤、负责人、状态和人类确认结果，可供未来后端可视化读取。
- `tasks/`：任务卡，描述目标、范围、参与者、禁止路径、验收和风险。
- `handoffs/`：交接记录，说明已做 / 未做 / 下一步 / 回滚范围。
- `reviews/`：审查记录，说明是否符合目标、是否越界、是否建议合并或回滚。
- `locks/`：本地临时锁文件。锁文件默认不入库，只用于提醒其他 agent 不要同时改同一块。
- `logs/`：本地非敏感运行记录。日志默认不入库。

## 安全规则

- 不要把 forbidden globs 的内容复制到这里。
- 不要把真实 `bridge.env`、聊天记录、私密记忆或 token 写进这里。
- `logs/` 和 `locks/*.lock` 默认被 `.gitignore` 忽略。
- 需要共享给其他 agent 的内容，应先脱敏，再写入 `tasks/`、`handoffs/` 或 `reviews/`。
- AI 完成计划步骤后先标记为待人类确认；人类确认后才能打勾为完成。
