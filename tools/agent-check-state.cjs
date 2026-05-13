const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(ROOT, "agent-state");
const SECTIONS = ["plans", "tasks", "handoffs", "reviews", "locks", "logs"];

function listFiles(section) {
  const dir = path.join(STATE_DIR, section);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".gitkeep")
    .map((entry) => entry.name);
}

function readLockSummary(name) {
  const lockPath = path.join(STATE_DIR, "locks", name);
  if (!lockPath.startsWith(path.join(STATE_DIR, "locks") + path.sep)) {
    return `${name}: invalid path`;
  }
  try {
    const text = fs.readFileSync(lockPath, "utf8").slice(0, 1200);
    const expires = text.match(/expiresAt:\s*(.+)/);
    return `${name}${expires ? ` expiresAt=${expires[1].trim()}` : ""}`;
  } catch (error) {
    return `${name}: ${error.message}`;
  }
}

if (!fs.existsSync(STATE_DIR)) {
  console.error("agent-state directory does not exist.");
  process.exit(1);
}

console.log("agent-state summary");
for (const section of SECTIONS) {
  const files = listFiles(section);
  console.log(`- ${section}: ${files.length}`);
  if (section === "locks" && files.length > 0) {
    for (const item of files) {
      console.log(`  - ${readLockSummary(item)}`);
    }
  }
}

console.log("No business files were scanned.");
