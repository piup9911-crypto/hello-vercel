const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TASK_DIR = path.join(ROOT, "agent-state", "tasks");

function usage() {
  console.error('Usage: node tools/agent-new-task.cjs "任务标题"');
  process.exit(1);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function timestamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}

function slugify(input) {
  const slug = String(input)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "task";
}

function writeFileSafe(filePath, content) {
  if (!filePath.startsWith(TASK_DIR + path.sep)) {
    throw new Error("Refusing to write outside agent-state/tasks.");
  }
  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const title = process.argv.slice(2).join(" ").trim();
if (!title) usage();

const stamp = timestamp();
const taskId = `task-${stamp}-${slugify(title)}`;
const filePath = path.join(TASK_DIR, `${stamp}-${taskId}.md`);
const now = new Date().toISOString();

const content = `# ${title}

> 不要粘贴 token、真实聊天记录、私密记忆、真实 env 或 forbidden globs 内容。

\`\`\`yaml
id: ${taskId}
title: ${JSON.stringify(title)}
createdAt: ${now}
createdBy: human
currentOwner: human
participants:
  - agentId: human
    participationMode: design
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
\`\`\`

## 变更前确认

- [ ] 已读取 \`docs/AGENT_PROJECT_BRIEF.md\`
- [ ] 已读取当前 active plan，或已为复杂任务建立 plan
- [ ] 已确认 allowedPaths / forbiddenPaths
- [ ] 已检查相关锁
- [ ] 已重新读取将要修改的目标文件当前内容
- [ ] 本任务不需要读取真实 env、真实聊天、真实记忆或 token
`;

try {
  writeFileSafe(filePath, content);
  console.log(`Created ${path.relative(ROOT, filePath)}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
