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
const RP_BOT_ROOT = path.join(PROJECT_ROOT, "telegram-rp-bot");
const TELEGRAM_LOCK_PATH = path.join(ROOT, "bridge-state", "bridge.lock.json");
const TELEGRAM_LOG_PATH = path.join(ROOT, "bridge-state", "bridge.log");
const OPENAI_LOG_PATH = path.join(ROOT, "st-bridge-state", "openai-bridge.log");
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
  return lines.length ? lines[lines.length - 1].slice(0, 800) : "";
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
  const apiKey = process.env.OPENAI_BRIDGE_API_KEY || "";
  const health = await requestLocalJson(`http://127.0.0.1:${port}/v1/models`, {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  });
  return {
    online: health.ok,
    checkedAt,
    port,
    pid: null,
    model:
      process.env.OPENAI_BRIDGE_DEFAULT_MODEL ||
      process.env.BRIDGE_GEMINI_MODEL_QUALITY ||
      process.env.BRIDGE_GEMINI_MODEL ||
      "gemini-3.1-pro-preview",
    lastLine: readLastLine(OPENAI_LOG_PATH)
  };
}

function getTelegramBridgeStatus(checkedAt) {
  const lock = readJson(TELEGRAM_LOCK_PATH);
  const pid = lock && lock.pid ? lock.pid : null;
  return {
    online: processAlive(pid),
    checkedAt,
    pid,
    lockFile: Boolean(lock),
    startedAt: lock && lock.startedAt ? lock.startedAt : null,
    lastLine: readLastLine(TELEGRAM_LOG_PATH)
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
  return {
    checkedAt,
    online: false,
    lastLine: ""
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
      publicUrl: process.env.GEM_PUBLIC_URL || process.env.PUBLIC_OPENAI_BRIDGE_URL || ""
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
