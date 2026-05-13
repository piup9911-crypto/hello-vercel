const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REVIEW_DIR = path.join(ROOT, "agent-state", "reviews");

function usage() {
  console.error("Usage: node tools/agent-new-review.cjs <taskId>");
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
  if (!filePath.startsWith(REVIEW_DIR + path.sep)) {
    throw new Error("Refusing to write outside agent-state/reviews.");
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
const filePath = path.join(REVIEW_DIR, `${stamp()}-${taskId}-review.md`);
const content = `# Review: ${taskId}

> 不要粘贴 token、真实聊天记录、私密记忆、真实 env 或 forbidden globs 内容。

\`\`\`yaml
taskId: ${taskId}
reviewAt: ${now}
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
\`\`\`

## Review 清单

- 是否符合任务目标：
- 是否违反边界：
- 是否有安全风险：
- 是否需要运行测试：
- 是否建议合并、继续修改或回滚：
- 回滚说明：
`;

try {
  writeFileSafe(filePath, content);
  console.log(`Created ${path.relative(ROOT, filePath)}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
