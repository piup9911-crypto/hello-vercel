# Agent Plan Template

> Plan 可以被后端可视化读取展示，但不要写入 token、真实聊天记录、私密记忆、真实 env 或 forbidden globs 内容。

```yaml
id:
title:
status: active
createdAt:
createdBy:
owners:
  - agentId:
    participationMode:
relatedTasks:
  - taskId:
humanConfirmationRequired: true
backendVisualizationNotes:
  visibleInDashboard: true
  dataSensitivity: non-sensitive
steps:
  - id: step-1
    title:
    owner:
    status: todo
    evidence:
    humanConfirmedBy:
    humanConfirmedAt:
    notes:
```

## 打勾规则

- AI 完成步骤后，把 `status` 改为 `pending_human_confirmation`，并填写 `evidence`。
- 人类确认后，才能把 `status` 改为 `confirmed_done`。
- 其他 AI 开工前必须先读当前 active plan。
- 如果 plan 与任务卡冲突，先停下，等待人类决定。
