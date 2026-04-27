const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { syncSharedMemory } = require("./shared-memory-sync.cjs");

const ROOT = __dirname;
const REAL_HOME = os.homedir();
const APPDATA_DIR =
  process.env.APPDATA || path.join(REAL_HOME, "AppData", "Roaming");
const GEMINI_CMD_PATH = path.join(APPDATA_DIR, "npm", "gemini.cmd");
const CLI_WORKSPACE = path.join(REAL_HOME, "gemini-test");
const BRIDGE_ENV_PATH = path.join(ROOT, "bridge.env");
const BOOTSTRAP_PROMPT_PATH = path.join(
  ROOT,
  "memory-docs",
  "generated",
  "cli-bootstrap-prompt.txt"
);
const DEFAULT_MODEL =
  process.env.BRIDGE_GEMINI_MODEL_QUALITY ||
  process.env.BRIDGE_GEMINI_MODEL ||
  "gemini-3.1-pro-preview";

function loadEnvFile(filePath, overrideExisting) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    value = value.replace(/(^['"]|['"]$)/g, "");
    if (overrideExisting || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        USERPROFILE: REAL_HOME,
        HOME: REAL_HOME
      },
      stdio: "inherit",
      windowsHide: false
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${path.basename(scriptPath)} exited with ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  loadEnvFile(path.join(REAL_HOME, ".gemini", ".env"), false);
  loadEnvFile(BRIDGE_ENV_PATH, true);

  // We keep the startup flow explicit and commented because the user is
  // collaborating with another CLI agent and wants this chain easy to audit.
  // 1) ingest new CLI messages into small/large summaries
  // 2) rebuild the independent memory documents
  // 3) start interactive Gemini and inject the compiled independent memory
  await runNodeScript(path.join(ROOT, "memory-ingest.cjs"), ["--source", "cli"]);
  await syncSharedMemory({
    targets: [CLI_WORKSPACE]
  });

  const bootstrapPrompt = fs.existsSync(BOOTSTRAP_PROMPT_PATH)
    ? fs.readFileSync(BOOTSTRAP_PROMPT_PATH, "utf8").trim()
    : "";
  const modelId = process.argv[2] || DEFAULT_MODEL;
  const args = ["-m", modelId];

  // `--prompt-interactive` lets us seed the session with independent memory
  // while still dropping the user into the normal interactive CLI afterwards.
  if (bootstrapPrompt) {
    args.push("-i", bootstrapPrompt);
  }

  const child = spawn(GEMINI_CMD_PATH, args, {
    cwd: CLI_WORKSPACE,
    env: {
      ...process.env,
      USERPROFILE: REAL_HOME,
      HOME: REAL_HOME
    },
    stdio: "inherit",
    windowsHide: false
  });

  child.on("error", (error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
  child.on("close", (code) => {
    process.exit(code || 0);
  });
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
