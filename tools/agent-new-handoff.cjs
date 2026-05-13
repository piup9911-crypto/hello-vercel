const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const HANDOFF_DIR = path.join(ROOT, "agent-state", "handoffs");

function usage() {
  console.error("Usage: node tools/agent-new-handoff.cjs <taskId>");
  process.exit(1);
}

function safeId(input) {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function writeFileSafe(filePath, content) {
  if (!filePath.startsWith(HANDOFF_DIR + path.sep)) {
    throw new Error("Refusing to write outside agent-state/handoffs.");
  }
  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const taskId = safeId(process.argv[2]);
if (!taskId) usage();

const now = new Date().toISOString();
const filePath = path.join(HANDOFF_DIR, `${stamp()}-${taskId}-handoff.md`);
const content = `# Handoff: ${taskId}

> 不要粘贴 token、真实聊天记录、私密记忆、真实 env 或 forbidden globs 内容。

\`\`\`yaml
taskId: ${taskId}
handoffAt: ${now}
fromAgent:
toAgent:
status:
changedFiles:
  - path:
    changeType:
done:
notDone:
uncertainties:
nextSteps:
humanDecisionsNeeded:
verification:
rollbackNotes:
  filesToRevert:
    - path:
  docsOrTemplatesOnly:
  businessLogicTouched:
  apiSchemaOrDeployTouched:
  notes:
\`\`\`

## 交接说明

- 做了什么：
- 没做什么：
- 哪些文件改了：
- 哪些地方不确定：
- 下一位 agent 应该从哪里继续：
- 需要人工决定的问题：
- 回滚说明：
`;

try {
  writeFileSafe(filePath, content);
  console.log(`Created ${path.relative(ROOT, filePath)}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
