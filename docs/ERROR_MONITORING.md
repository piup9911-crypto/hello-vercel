# Error Inbox / 实时错误收集箱

## 目标

为了让非工程背景的使用者在网页或 API 遇到错误时，不再束手无策，我们引入了轻量级的 Error Inbox。它的核心目的是：
1. **收集案发现场：** 捕捉前端 (`window.onerror`, `unhandledrejection`) 和后端的异常。
2. **脱敏保护：** 严格过滤所有敏感数据，绝不记录 token、私密记忆或完整网络体。
3. **一键救援：** 将收集到的错误与 `BUG_TRIAGE_MAP.json` 结合，在 Backend Cockpit 中生成“一键排查 Prompt”，交给 Codex、cc 或 gem 处理，避免全仓库扫描。

## 允许记录的字段白名单

- `createdAt` (事件发生时间)
- `level` (error, warn, info)
- `source` (frontend, api)
- `page` (如 `/magic.html`)
- `api` (如 `/api/shared-memory.mjs`)
- `route`
- `status` (HTTP 状态码，如 500)
- `message` (错误摘要，限 500 字)
- `moduleHint` (可选的关联模块名)
- `requestId` (用于链路追踪)
- `userAction` (崩溃前的用户最后一步操作，如“Clicked button #save”，限 200 字)
- `stackSummary` (简要调用栈，限 1500 字)
- `file` (出错的文件路径)
- `line` (出错行号)
- `column` (出错列号)

## 绝对禁止记录的敏感数据

为了保证极高的安全和隐私红线，以下内容**绝不**记录或上报：
- Cookie
- Authorization header
- 任何形式的 token、secret、password
- 环境变量 (env) 及其值
- Supabase service role key
- Telegram bot token
- 完整的 request body 和 response body
- localStorage / sessionStorage 的内容
- 用户在输入框中填写的具体内容
- 真实的聊天全文
- 私密记忆全文
- `bridge.env` 的内容

如果错误 payload 中包含了 `token`, `cookie`, `secret`, `env` 等疑似敏感的 Key，接口会将其直接丢弃；如果 `message` 或 `stackSummary` 中包含了疑似敏感信息，上报脚本也会对其进行脱敏替换。

## 配合 BUG_TRIAGE_MAP 生成修 Bug Prompt 的原理

1. `backend-cockpit.html` 会拉取 `/api/error-events` 的最新错误。
2. 当人类点击“复制修 Bug Prompt”时，Cockpit 会根据错误的 `page`、`api` 或 `file` 字段去 `BUG_TRIAGE_MAP.json` 中匹配最相关的 `module`。
3. 生成的 Prompt 会将**“案发现场（错误摘要、文件、行号）”**与**“排查心法（优先读取文件、推荐检查步骤、禁止读取的敏感路径）”**无缝拼接。
4. 人类直接将该 Prompt 发给 Agent，Agent 即可精准降落到对应模块展开排查。

## SQL 草案 (如果需要接入线上 Supabase)

第一版代码在没有建表时采用内存兜底 (in-memory mock)，若要持久化保存错误，可在 Supabase 中执行以下草案：

```sql
create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'unknown',
  level text not null default 'error',
  page text,
  api text,
  route text,
  status int,
  message text not null default '',
  module_hint text,
  request_id text,
  user_action text,
  stack_summary text,
  file text,
  line int,
  column_num int,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists error_events_created_at_idx
  on public.error_events (created_at desc);

alter table public.error_events enable row level security;

-- 允许所有认证用户查看错误（根据权限需要可收紧）
create policy "Authenticated users can read error events"
on public.error_events
for select
to authenticated
using (true);

-- 允许任何来源插入错误（供前端匿名收集）
create policy "Anyone can insert error events"
on public.error_events
for insert
with check (true);
```
