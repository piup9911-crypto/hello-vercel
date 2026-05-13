# Agent Task Template

> 不要粘贴 token、真实聊天记录、私密记忆、真实 env 或 forbidden globs 内容。

```yaml
id:
title:
createdAt:
createdBy:
currentOwner:
participants:
  - agentId:
    participationMode:
goal:
nonGoals:
contextFiles:
  - docs/AGENT_PROJECT_BRIEF.md
  - agent-state/plans/
allowedPaths:
  - docs/**
forbiddenPaths:
  - tools/gemini-cli-telegram/bridge-state/**
  - tools/gemini-cli-telegram/bridge-home/**
  - tools/gemini-cli-telegram/bridge-workspace/INDEPENDENT_MEMORY.md
  - tools/gemini-cli-telegram/memory-docs/private/**
  - tools/gemini-cli-telegram/memory-docs/trash/**
  - tools/gemini-cli-telegram/bridge.env
  - "**/*.env"
  - "**/*token*"
  - "**/*secret*"
expectedOutputs:
verification:
risks:
handoffNotes:
reviewNotes:
status: proposed
```

## 变更前确认

- [ ] 已读取 `docs/AGENT_PROJECT_BRIEF.md`
- [ ] 已读取当前 active plan，或已为复杂任务建立 plan
- [ ] 已确认 allowedPaths / forbiddenPaths
- [ ] 已检查相关锁
- [ ] 已重新读取将要修改的目标文件当前内容
- [ ] 本任务不需要读取真实 env、真实聊天、真实记忆或 token
