# Backend Cockpit v0.1

`backend-cockpit.html` 当前定位为 Bug Triage Cockpit。它不是普通数据库后台，也不展示所有数据库内容；它是一个只读排查导航，用手写 / 半手写的 bug triage map 帮人类和 agent 按症状快速找到应该优先阅读的文件。

## 目标

- 按模块和症状定位相关页面、API、文档和历史 bug。
- 生成最小 Agent Context Pack，避免 Codex / cc / gem 一上来全仓库遍历。
- 明确 forbidden paths，让排查过程不读取真实 token、env、私密记忆或真实聊天。
- 为未来后端可视化保留只读数据入口。

## 非目标

- 不是数据库后台。
- 不展示 Supabase 表内容。
- 不启动、重启、删除、清理任何本机服务。
- 不写记忆、不改数据库、不改部署配置。
- 不读取真实 `bridge.env`、`bridge-state/chats/`、private memory、trash 或 token。

## 数据来源

Cockpit 优先读取：

- `api/backend-overview.mjs`

如果 API 不可用，前端可以直接读取：

- `docs/BUG_TRIAGE_MAP.json`

这两个路径都只提供安全摘要。`api/backend-overview.mjs` 不扫描仓库，只读取 `docs/BUG_TRIAGE_MAP.json`。

## 如何新增 BUG_TRIAGE_MAP.json 模块

在 `docs/BUG_TRIAGE_MAP.json` 的 `modules` 数组里新增一项：

```json
{
  "id": "module-id",
  "name": "Module Name",
  "description": "这个模块负责什么。",
  "pages": ["page.html"],
  "apis": ["api/example.mjs"],
  "docs": ["docs/example.md"],
  "symptoms": ["用户看到的症状"],
  "priorityFiles": ["page.html", "api/example.mjs"],
  "recommendedChecks": ["先读页面事件处理", "再读 API 错误分支"]
}
```

维护规则：

- 优先手写，不要运行全仓库自动扫描器生成。
- `priorityFiles` 要保持小而准。
- `symptoms` 写用户或维护者真实会搜索的话。
- `recommendedChecks` 写排查顺序，不要写执行危险操作。
- 不要把 forbidden paths 放进 `priorityFiles`。

## 如何维护 knownBugs

`knownBugs` 是历史 bug 索引，第一版手动维护，可参考 `CODE_REVIEW_FIXES.md`。

字段建议：

- `bugId`
- `title`
- `file`
- `symptom`
- `searchTag`
- `regressionRisk`
- `recommendedChecks`

维护规则：

- `searchTag` 尽量对应代码或文档里的固定标签，例如 `[BUG-4 FIX]`。
- `recommendedChecks` 写回归检查点，不要复制大段历史正文。
- 如果 bug 涉及敏感数据，只写脱敏症状和文件路径，不写真实内容。

## 安全边界

这些内容不能写入 cockpit、triage map、prompt pack、任务卡或日志：

- token
- cookie
- Supabase service role key
- Telegram bot token
- 真实 `bridge.env`
- 真实聊天记录
- 私密记忆
- trash
- 任何真实 env / secret

默认 forbidden paths 见 `docs/BUG_TRIAGE_MAP.json` 和 `docs/AGENT_PROJECT_BRIEF.md`。`bridge.env.example` 是公开模板，可以引用；真实 `bridge.env` 不可以读取或复制。

## v0.1 可用性

- Bug Triage 区域可以按模块名、症状、页面、API 和 known bug 搜索。
- 搜索只过滤前端已经加载的 triage map，不请求新 API。
- Prompt Pack 会根据当前模块生成最小排查上下文。
- 如果选中了具体症状，Prompt Pack 只围绕该症状生成。

## 验证

修改 cockpit API 时运行：

```cmd
node --check api/backend-overview.mjs
```

修改 `docs/BUG_TRIAGE_MAP.json` 后至少确认 JSON 可解析：

```cmd
node -e "JSON.parse(require('fs').readFileSync('docs/BUG_TRIAGE_MAP.json','utf8')); console.log('ok')"
```
