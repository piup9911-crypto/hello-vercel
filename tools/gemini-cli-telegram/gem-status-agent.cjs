const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const {
  ROOT,
  getSharedMemoryConfig,
  httpRequestJson
} = require("./cloud-memory-client.cjs");

const PROJECT_ROOT = path.resolve(ROOT, "..", "..", "..");
const LEGACY_GEM_ROOT =
  process.env.GEM_LEGACY_BRIDGE_ROOT ||
  path.join(os.homedir(), "Documents", "Codex", "2026-04-21-gemini-cli-telegram");
const RP_BOT_ROOT = path.join(PROJECT_ROOT, "telegram-rp-bot");
const GEM_ROOTS = [ROOT, LEGACY_GEM_ROOT].filter((item, index, all) => item && all.indexOf(item) === index);
const TELEGRAM_LOCK_PATHS = GEM_ROOTS.map((root) => path.join(root, "bridge-state", "bridge.lock.json"));
const TELEGRAM_LOG_PATHS = GEM_ROOTS.map((root) => path.join(root, "bridge-state", "bridge.log"));
const OPENAI_LOG_PATHS = GEM_ROOTS.map((root) => path.join(root, "st-bridge-state", "openai-bridge.log"));
const PUBLIC_URL_PATHS = GEM_ROOTS.map((root) => path.join(root, "st-bridge-state", "public-openai-bridge-url.txt"));
const TUNNEL_LOG_PATHS = GEM_ROOTS.flatMap((root) => [
  path.join(root, "st-bridge-state", "cloudflared.out.log"),
  path.join(root, "st-bridge-state", "cloudflared-test.log"),
  path.join(root, "st-bridge-state", "localhostrun.out.log"),
  path.join(root, "st-bridge-state", "localhostrun-json.out.log")
]);
const RP_PID_PATH = path.join(RP_BOT_ROOT, "data", "bot.pid");
const RP_LOG_PATH = path.join(RP_BOT_ROOT, "data", "bot.log");
const RP_ERR_LOG_PATH = path.join(RP_BOT_ROOT, "data", "bot.err.log");
const RP_STATE_PATH = path.join(RP_BOT_ROOT, "data", "rp-state.json");
const OPENAI_START_CMD = path.join(ROOT, "start-gemini-cli-openai-bridge.cmd");
const TELEGRAM_START_CMD = path.join(ROOT, "start-telegram-gem-bridge.cmd");
const STATUS_INTERVAL_MS = Math.max(
  15000,
  Number.parseInt(process.env.GEM_STATUS_AGENT_INTERVAL_MS || "60000", 10) || 60000
);

function log(...args) {
  const line = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
  process.stdout.write(`[gem-status-agent] ${new Date().toISOString()} ${line}\n`);
}

function apiUrlFor(pathname, explicit) {
  if (explicit) return explicit;
  const config = getSharedMemoryConfig();
  const base = config.apiUrl || "";
  if (!base) return "";
  return base.replace(/\/api\/shared-memory(?:\?.*)?$/i, `/api/${pathname}`);
}

function getConfig() {
  return {
    statusUrl: apiUrlFor("gem-status", process.env.GEM_STATUS_URL || ""),
    controlUrl: apiUrlFor("gem-control", process.env.GEM_CONTROL_URL || ""),
    syncToken: process.env.SHARED_MEMORY_SYNC_TOKEN || getSharedMemoryConfig().syncToken || ""
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readLastLine(filePath) {
  const text = readText(filePath).trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.length ? lines[lines.length - 1].replace(/\x1b\[[0-9;]*m/g, "").slice(0, 800) : "";
}

function firstExisting(paths) {
  return paths.find((filePath) => fs.existsSync(filePath)) || paths[0] || "";
}

function newestExisting(paths) {
  let best = "";
  let bestTime = 0;
  for (const filePath of paths) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs >= bestTime) {
        best = filePath;
        bestTime = stat.mtimeMs;
      }
    } catch {}
  }
  return best || paths[0] || "";
}

function fileUpdatedAt(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function findProcessByCommand(pattern) {
  if (!pattern) return null;
  const escaped = pattern.replace(/'/g, "''");
  const script = [
    "$pattern = '" + escaped + "';",
    "Get-CimInstance Win32_Process",
    "| Where-Object { $_.CommandLine -and $_.CommandLine -like \"*$pattern*\" }",
    "| Select-Object -First 1 ProcessId,CommandLine",
    "|",
    "ConvertTo-Json -Compress"
  ].join(" ");
  try {
    const output = require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true
    });
    if (!output.trim()) return null;
    const parsed = JSON.parse(output);
    return parsed && parsed.ProcessId ? { pid: parsed.ProcessId, commandLine: parsed.CommandLine || "" } : null;
  } catch {
    return null;
  }
}

function getListeningPid(port) {
  try {
    const output = require("child_process").execFileSync("netstat", ["-ano"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true
    });
    const pattern = new RegExp(`^\\s*TCP\\s+\\S+:${String(port)}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "im");
    const match = output.match(pattern);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function findPublicUrl() {
  for (const filePath of PUBLIC_URL_PATHS) {
    const saved = readText(filePath).trim();
    if (saved) return saved;
  }
  for (const filePath of TUNNEL_LOG_PATHS) {
    const text = readText(filePath);
    const cloudflareMatch = text.match(/https:\/\/[A-Za-z0-9-]+\.trycloudflare\.com/i);
    if (cloudflareMatch && cloudflareMatch[0]) return `${cloudflareMatch[0].replace(/[.,;]+$/, "")}/v1`;
    const localhostRunMatch = text.match(/tunneled with tls termination,\s+(https:\/\/[A-Za-z0-9.-]+)/i);
    if (localhostRunMatch && localhostRunMatch[1]) return `${localhostRunMatch[1].replace(/[.,;]+$/, "")}/v1`;
  }
  return process.env.GEM_PUBLIC_URL || process.env.PUBLIC_OPENAI_BRIDGE_URL || "";
}

function processAlive(pid) {
  const n = Number.parseInt(String(pid || ""), 10);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function requestLocalJson(urlString, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      urlString,
      {
        method: "GET",
        headers,
        timeout: 3000
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let data = null;
          try {
            data = body ? JSON.parse(body) : null;
          } catch {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            statusCode: res.statusCode,
            data
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, data: null });
    });
    req.on("error", () => {
      resolve({ ok: false, statusCode: 0, data: null });
    });
    req.end();
  });
}

async function getOpenAiBridgeStatus(checkedAt) {
  const port = Number.parseInt(process.env.OPENAI_BRIDGE_PORT || "4141", 10) || 4141;
  const pid = getListeningPid(port);
  const apiKey = process.env.OPENAI_BRIDGE_API_KEY || "";
  const health = await requestLocalJson(`http://127.0.0.1:${port}/v1/models`, {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  });
  return {
    online: Boolean(pid) || health.ok,
    checkedAt,
    port,
    pid,
    model:
      process.env.OPENAI_BRIDGE_DEFAULT_MODEL ||
      process.env.BRIDGE_GEMINI_MODEL_QUALITY ||
      process.env.BRIDGE_GEMINI_MODEL ||
      "gemini-3.1-pro-preview",
    logUpdatedAt: fileUpdatedAt(newestExisting(OPENAI_LOG_PATHS)),
    lastLine: readLastLine(newestExisting(OPENAI_LOG_PATHS))
  };
}

function getTelegramBridgeStatus(checkedAt) {
  const lockPath = firstExisting(TELEGRAM_LOCK_PATHS);
  const logPath = newestExisting(TELEGRAM_LOG_PATHS);
  const lock = readJson(lockPath);
  const commandProcess = findProcessByCommand("telegram-gem-bridge.cjs");
  const pid = lock && lock.pid ? lock.pid : commandProcess && commandProcess.pid ? commandProcess.pid : null;
  return {
    online: processAlive(pid),
    checkedAt,
    pid,
    lockFile: Boolean(lock),
    startedAt: lock && lock.startedAt ? lock.startedAt : null,
    root: path.dirname(path.dirname(logPath || lockPath || ROOT)),
    logUpdatedAt: fileUpdatedAt(logPath),
    lastLine: readLastLine(logPath)
  };
}

function getMemoryStatus(config, checkedAt) {
  return {
    checkedAt,
    configured: Boolean(config.statusUrl && config.syncToken),
    url: config.statusUrl ? config.statusUrl.replace(/\/api\/gem-status(?:\?.*)?$/i, "/api/shared-memory") : "",
    hasToken: Boolean(config.syncToken)
  };
}

function getPublicTunnelStatus(checkedAt) {
  const url = findPublicUrl();
  const cloudflared = findProcessByCommand("cloudflared");
  const sshTunnel = findProcessByCommand("localhost.run");
  return {
    checkedAt,
    online: Boolean(url && (cloudflared || sshTunnel)),
    url,
    pid: cloudflared && cloudflared.pid ? cloudflared.pid : sshTunnel && sshTunnel.pid ? sshTunnel.pid : null,
    lastLine: readLastLine(newestExisting(TUNNEL_LOG_PATHS))
  };
}

function getRpBotStatus(checkedAt) {
  const pidText = readText(RP_PID_PATH).trim();
  const pid = pidText ? Number.parseInt(pidText, 10) : null;
  const state = readJson(RP_STATE_PATH);
  const lastErr = readLastLine(RP_ERR_LOG_PATH);
  return {
    online: processAlive(pid),
    checkedAt,
    pid,
    botName: process.env.BOT_NAME || "rp-gem-bot",
    stateFile: fs.existsSync(RP_STATE_PATH),
    gemChatRecordsUrl: process.env.GEM_CHAT_RECORDS_URL || "http://127.0.0.1:4144",
    lastMessageAt: state && state.updatedAt ? state.updatedAt : null,
    logUpdatedAt: fileUpdatedAt(lastErr ? RP_ERR_LOG_PATH : RP_LOG_PATH),
    lastLine: lastErr || readLastLine(RP_LOG_PATH)
  };
}

async function buildStatus(config) {
  const checkedAt = new Date().toISOString();
  const openaiBridge = await getOpenAiBridgeStatus(checkedAt);
  return {
    schemaVersion: 1,
    reporter: {
      hostname: os.hostname(),
      platform: process.platform,
      agent: "gem-status-agent"
    },
    services: {
      openaiBridge,
      publicTunnel: getPublicTunnelStatus(checkedAt),
      telegramBridge: getTelegramBridgeStatus(checkedAt),
      memorySync: getMemoryStatus(config, checkedAt),
      rpTelegramBot: getRpBotStatus(checkedAt)
    },
    links: {
      publicUrl: findPublicUrl()
    },
    notes: ""
  };
}

async function postJson(url, payload, config, method = "POST") {
  return httpRequestJson(url, {
    method,
    timeoutMs: 15000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Memory-Sync-Token": config.syncToken,
      "X-Memory-Client": "gem-status-agent"
    },
    body: JSON.stringify(payload)
  });
}

async function getJson(url, config) {
  return httpRequestJson(url, {
    method: "GET",
    timeoutMs: 15000,
    headers: {
      Accept: "application/json",
      "X-Memory-Sync-Token": config.syncToken,
      "X-Memory-Client": "gem-status-agent"
    }
  });
}

function launchCmd(cmdPath) {
  if (!fs.existsSync(cmdPath)) {
    throw new Error(`Missing command: ${cmdPath}`);
  }
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", cmdPath], {
    cwd: path.dirname(cmdPath),
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function updateCommand(config, command, status, message) {
  if (!config.controlUrl || !command || !command.id) return;
  await postJson(
    config.controlUrl,
    {
      id: command.id,
      status,
      message
    },
    config,
    "PUT"
  );
}

async function executeCommand(config, command) {
  if (!command || command.status !== "queued") return false;
  await updateCommand(config, command, "running", "Local Gem status agent claimed the command.");
  try {
    if (command.action === "start_public_openai_bridge") {
      launchCmd(OPENAI_START_CMD);
      await updateCommand(config, command, "completed", "OpenAI Bridge launch requested.");
      return true;
    }
    if (command.action === "start_telegram_bridge") {
      launchCmd(TELEGRAM_START_CMD);
      await updateCommand(config, command, "completed", "Telegram Bridge launch requested.");
      return true;
    }
    if (command.action === "sync_status_once") {
      await postStatus(config);
      await updateCommand(config, command, "completed", "Gem status synced once.");
      return true;
    }
    await updateCommand(config, command, "skipped", `Unsupported action: ${command.action}`);
    return false;
  } catch (error) {
    await updateCommand(config, command, "failed", error && error.message ? error.message : String(error));
    return false;
  }
}

async function postStatus(config) {
  if (!config.statusUrl || !config.syncToken) {
    throw new Error("Missing GEM_STATUS_URL/SHARED_MEMORY_URL or SHARED_MEMORY_SYNC_TOKEN.");
  }
  const status = await buildStatus(config);
  await postJson(config.statusUrl, status, config, "PUT");
  return status;
}

async function tick(options = {}) {
  const config = getConfig();
  const status = await postStatus(config);
  log("status synced", {
    openai: status.services.openaiBridge.online,
    telegram: status.services.telegramBridge.online,
    rp: status.services.rpTelegramBot.online
  });

  if (!options.noControl && config.controlUrl) {
    const response = await getJson(config.controlUrl, config);
    const command = response.data && response.data.command ? response.data.command : null;
    if (command && command.status === "queued") {
      await executeCommand(config, command);
    }
  }

  if (options.once) return;
}

async function main() {
  const once = process.argv.includes("--once");
  const noControl = process.argv.includes("--no-control");
  if (process.argv.includes("--print")) {
    const config = getConfig();
    process.stdout.write(`${JSON.stringify(await buildStatus(config), null, 2)}\n`);
    return;
  }
  if (once) {
    await tick({ once: true, noControl });
    return;
  }

  await tick({ noControl }).catch((error) => {
    log("tick failed", error && error.message ? error.message : String(error));
  });
  setInterval(() => {
    tick({ noControl }).catch((error) => {
      log("tick failed", error && error.message ? error.message : String(error));
    });
  }, STATUS_INTERVAL_MS);
}

main().catch((error) => {
  log("fatal", error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
