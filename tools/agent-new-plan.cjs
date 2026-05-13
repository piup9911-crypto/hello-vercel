const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PLAN_DIR = path.join(ROOT, "agent-state", "plans");

function usage() {
  console.error('Usage: node tools/agent-new-plan.cjs "计划标题"');
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
  return slug || "plan";
}

function writeFileSafe(filePath, content) {
  if (!filePath.startsWith(PLAN_DIR + path.sep)) {
    throw new Error("Refusing to write outside agent-state/plans.");
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
const planId = `plan-${stamp}-${slugify(title)}`;
const filePath = path.join(PLAN_DIR, `${stamp}-${planId}.md`);
const now = new Date().toISOString();

const content = `# ${title}

> Plan 可以被后端可视化读取展示，但不要写入 token、真实聊天记录、私密记忆、真实 env 或 forbidden globs 内容。

\`\`\`yaml
id: ${planId}
title: ${JSON.stringify(title)}
status: active
createdAt: ${now}
createdBy: human
owners:
  - agentId: human
    participationMode: design
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
\`\`\`

## 打勾规则

- AI 完成步骤后，把 \`status\` 改为 \`pending_human_confirmation\`，并填写 \`evidence\`。
- 人类确认后，才能把 \`status\` 改为 \`confirmed_done\`。
- 其他 AI 开工前必须先读当前 active plan。
- 如果 plan 与任务卡冲突，先停下，等待人类决定。
`;

try {
  writeFileSafe(filePath, content);
  console.log(`Created ${path.relative(ROOT, filePath)}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
