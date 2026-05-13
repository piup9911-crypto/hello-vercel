# Agent Review Template

> 不要粘贴 token、真实聊天记录、私密记忆、真实 env 或 forbidden globs 内容。

```yaml
taskId:
reviewAt:
reviewer:
decision: needs_review
targetFiles:
  - path:
meetsGoal:
boundaryViolations:
securityRisks:
testsNeeded:
recommendation: continue_modify
findings:
rollbackNotes:
  filesToRevert:
    - path:
  docsOrTemplatesOnly:
  businessLogicTouched:
  apiSchemaOrDeployTouched:
  notes:
```

## Review 清单

- 是否符合任务目标：
- 是否违反边界：
- 是否有安全风险：
- 是否需要运行测试：
- 是否建议合并、继续修改或回滚：
- 回滚说明：
