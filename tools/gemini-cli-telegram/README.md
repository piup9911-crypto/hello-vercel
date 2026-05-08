# Telegram Gemini Bridge

最后更新：2026-05-08

这个目录保存本机 Telegram bridge、Gemini CLI bridge、OpenAI 兼容 bridge，以及 Telegram-only 独立记忆系统。

## 当前记忆边界

云端记忆和独立记忆现在只服务 Telegram bridge。

普通 Gemini CLI 已经和这套记忆系统解耦：

- 桌面 `C:\Users\yx\Desktop\gemini-start.cmd` 不再运行记忆脚本
- `memory-ingest.cjs` 不再支持 `--source cli`
- `shared-memory-sync.cjs` 不再写入 `C:\Users\yx\gemini-test`
- 旧的 `start-gemini-cli-with-memory.*` 已删除
- 旧的 `start-shared-memory-gemini.cmd` 已删除

普通 Gemini CLI 的启动路径现在应该尽量短：设置代理，进入 `gemini-test`，启动 `gemini`。

## 常用启动

### 启动 Telegram bridge

```cmd
start-telegram-gem-bridge.cmd
```

或：

```cmd
node telegram-gem-bridge.cjs
```

### 启动本地记忆管理器

```cmd
start-independent-memory-manager.cmd
```

然后打开：

```text
http://127.0.0.1:4142/
```

### 启动普通 Gemini CLI

使用桌面：

```text
C:\Users\yx\Desktop\gemini-start.cmd
```

这个启动器不再加载 Telegram 云端记忆。

## 记忆系统

Telegram 记忆的当前流程：

1. Telegram 聊天写入 `bridge-state/chats/`
2. Telegram bridge 在完成 10 轮对话并空闲 2 分钟后触发摄取
3. `memory-ingest.cjs --source telegram --chat-id <id>` 生成小摘要
4. 小摘要积累到阈值后合并为大摘要
5. `shared-memory-sync.cjs` 编译可读记忆
6. 编译结果写入 `bridge-workspace/INDEPENDENT_MEMORY.md`
7. Telegram bridge 构造 prompt 时读取这份记忆

`GEMINI.md` 仍然是手动维护的人格层，自动摘要不能改写它。

## 主要文件

| 文件 | 用途 |
| --- | --- |
| `telegram-gem-bridge.cjs` | Telegram 主桥接程序 |
| `memory-ingest.cjs` | Telegram 聊天摘要摄取 |
| `shared-memory-sync.cjs` | Telegram 可读记忆编译 |
| `independent-memory-store.cjs` | 文件型独立记忆存储 |
| `independent-memory-manager.cjs` | 本地记忆管理 Web 服务 |
| `cloud-memory-client.cjs` | 云端记忆 API 客户端 |
| `gemini-cli-openai-bridge.cjs` | OpenAI 兼容接口桥接 |
| `telegram-mcp-fixed.cjs` | Telegram MCP 服务端 |

## 维护规则

- 不要把 `memory-ingest.cjs` 加回普通 Gemini CLI 启动链
- 不要恢复 `memory-ingest.cjs --source cli`
- 不要把 `INDEPENDENT_MEMORY.md` 同步到 `C:\Users\yx\gemini-test`
- 不要重新添加带记忆的 Gemini CLI 启动器
- 如果以后普通 Gemini CLI 也需要记忆，另建独立系统，不复用 Telegram 云端记忆

更多细节见 `MEMORY_SYSTEM_OVERVIEW.md` 和 `MAINTAINER_GUARDRAILS.md`。

## 验证命令

```cmd
node --check memory-ingest.cjs
node --check shared-memory-sync.cjs
node --check telegram-gem-bridge.cjs
node --check independent-memory-manager.cjs
node memory-ingest.cjs --source cli
node memory-ingest.cjs --source telegram
node shared-memory-sync.cjs
```

预期：

- 语法检查通过
- `--source cli` 明确报错
- `--source telegram` 正常完成
- `shared-memory-sync.cjs` 只写入 Telegram 工作区
