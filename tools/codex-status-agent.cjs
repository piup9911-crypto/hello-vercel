const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");

const ROOT = __dirname;
const GEM_TOOLS_ROOT = path.join(ROOT, "gemini-cli-telegram");

function loadEnvFile(filePath, overrideExisting) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    value = value.replace(/(^['"]|['"]$)/g, "");
    if (overrideExisting || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(os.homedir(), ".gemini", ".env"), false);
loadEnvFile(path.join(GEM_TOOLS_ROOT, "bridge.env"), false);

const STATUS_INTERVAL_MS = Math.max(
  15000,
  Number.parseInt(process.env.CODEX_STATUS_AGENT_INTERVAL_MS || "60000", 10) || 60000
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
  process.stdout.write(`[codex-status-agent] ${new Date().toISOString()} ${line}\n`);
}

function apiUrlFor(pathname, explicit) {
  if (explicit) return explicit;
  const base = process.env.SHARED_MEMORY_URL || process.env.BRIDGE_SHARED_MEMORY_URL || "";
  if (!base) return "";
  return base.replace(/\/api\/shared-memory(?:\?.*)?$/i, `/api/${pathname}`);
}

function getConfig() {
  return {
    statusUrl: apiUrlFor("codex-status", process.env.CODEX_STATUS_URL || ""),
    controlUrl: apiUrlFor("codex-control", process.env.CODEX_CONTROL_URL || ""),
    syncToken: process.env.SHARED_MEMORY_SYNC_TOKEN || process.env.MEMORY_SYNC_TOKEN || "",
    qiCommandPattern: process.env.CODEX_QI_PROCESS_PATTERN || "",
    ccCommandPattern: process.env.CODEX_CCGRAM_PROCESS_PATTERN || "",
    qiStartCommand: process.env.CODEX_QI_START_COMMAND || "",
    qiRestartCommand: process.env.CODEX_QI_RESTART_COMMAND || "",
    ccStartCommand: process.env.CODEX_CCGRAM_START_COMMAND || "",
    ccRestartCommand: process.env.CODEX_CCGRAM_RESTART_COMMAND || "",
    ccTmuxSession: process.env.CODEX_CCGRAM_TMUX_SESSION || "ccgram-codex"
  };
}

function httpRequestJson(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === "http:" ? http : https;
    const req = transport.request(
      url,
      {
        method: options.method || "GET",
        headers: options.headers || {},
        timeout: options.timeoutMs || 15000
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ data: parsed, raw: data, statusCode: res.statusCode });
            return;
          }
          reject(new Error((parsed && (parsed.error || parsed.message)) || data || `Request failed with ${res.statusCode}`));
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Request timed out."));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function execCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: options.timeoutMs || 8000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        error: error ? error.message : ""
      });
    });
  });
}

async function findWindowsProcess(pattern) {
  if (!pattern) return { online: null, pid: null, lastLine: "Set CODEX_*_PROCESS_PATTERN to enable process detection." };
  const script = [
    "$pattern = $args[0]",
    "Get-CimInstance Win32_Process |",
    "Where-Object { $_.CommandLine -and $_.CommandLine -like \"*$pattern*\" } |",
    "Select-Object -First 1 ProcessId,CommandLine |",
    "ConvertTo-Json -Compress"
  ].join(" ");
  const result = await execCapture("powershell.exe", ["-NoProfile", "-Command", script, pattern]);
  if (!result.ok || !result.stdout.trim()) {
    return { online: false, pid: null, lastLine: result.error || "Process not found." };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      online: Boolean(parsed && parsed.ProcessId),
      pid: parsed && parsed.ProcessId ? parsed.ProcessId : null,
      lastLine: parsed && parsed.CommandLine ? String(parsed.CommandLine).slice(0, 800) : ""
    };
  } catch {
    return { online: false, pid: null, lastLine: result.stdout.trim().slice(0, 800) };
  }
}

async function getWslTmuxStatus(sessionName) {
  const result = await execCapture("wsl.exe", ["-e", "sh", "-lc", `tmux has-session -t ${JSON.stringify(sessionName)} 2>/dev/null && echo online || echo offline`]);
  if (!result.ok && !result.stdout.trim()) {
    return {
      online: null,
      tmuxSession: sessionName,
      lastLine: result.error || "WSL/tmux not available."
    };
  }
  const online = result.stdout.includes("online");
  return {
    online,
    tmuxSession: sessionName,
    lastLine: online ? "tmux session is present." : "tmux session not found."
  };
}

async function buildStatus(config) {
  const checkedAt = new Date().toISOString();
  const qi = await findWindowsProcess(config.qiCommandPattern);
  const ccProcess = await findWindowsProcess(config.ccCommandPattern);
  const ccTmux = await getWslTmuxStatus(config.ccTmuxSession);
  return {
    schemaVersion: 1,
    reporter: {
      hostname: os.hostname(),
      platform: process.platform,
      agent: "codex-status-agent"
    },
    services: {
      qiBridge: {
        online: qi.online,
        checkedAt,
        pid: qi.pid,
        lockFile: Boolean(process.env.CODEX_QI_LOCK_FILE && fs.existsSync(process.env.CODEX_QI_LOCK_FILE)),
        model: process.env.CODEX_QI_MODEL || "gpt-5.5",
        sandbox: process.env.CODEX_QI_SANDBOX || "danger-full-access",
        reasoning: process.env.CODEX_QI_REASONING || "medium",
        lastLine: qi.lastLine || ""
      },
      ccgramBridge: {
        online: ccProcess.online === null ? ccTmux.online : ccProcess.online,
        checkedAt,
        instanceName: process.env.CODEX_CCGRAM_INSTANCE || "codex-ccgram",
        groupId: process.env.CODEX_CCGRAM_GROUP_ID || "",
        tmuxSession: ccTmux.tmuxSession,
        provider: process.env.CODEX_CCGRAM_PROVIDER || "codex",
        lastLine: ccProcess.lastLine || ccTmux.lastLine || ""
      }
    },
    links: {},
    notes: ""
  };
}

async function requestJson(url, payload, config, method = "POST") {
  return httpRequestJson(url, {
    method,
    timeoutMs: 15000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Memory-Sync-Token": config.syncToken,
      "X-Memory-Client": "codex-status-agent"
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
}

function launch(commandLine) {
  if (!commandLine) throw new Error("No local command configured for this action.");
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/c", commandLine], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function updateCommand(config, command, status, message) {
  if (!config.controlUrl || !command || !command.id) return;
  await requestJson(
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

async function postStatus(config) {
  if (!config.statusUrl || !config.syncToken) {
    throw new Error("Missing CODEX_STATUS_URL/SHARED_MEMORY_URL or SHARED_MEMORY_SYNC_TOKEN.");
  }
  const status = await buildStatus(config);
  await requestJson(config.statusUrl, status, config, "PUT");
  return status;
}

async function executeCommand(config, command) {
  if (!command || command.status !== "queued") return false;
  await updateCommand(config, command, "running", "Local Codex status agent claimed the command.");
  try {
    const map = {
      start_codex_bridge: config.qiStartCommand,
      restart_codex_bridge: config.qiRestartCommand || config.qiStartCommand,
      start_ccgram: config.ccStartCommand,
      restart_ccgram: config.ccRestartCommand || config.ccStartCommand
    };
    if (command.action === "sync_codex_status" || command.action === "sync_ccgram_status") {
      await postStatus(config);
      await updateCommand(config, command, "completed", "Codex status synced once.");
      return true;
    }
    if (Object.prototype.hasOwnProperty.call(map, command.action)) {
      launch(map[command.action]);
      await updateCommand(config, command, "completed", "Local launch command requested.");
      return true;
    }
    await updateCommand(config, command, "skipped", `Unsupported action: ${command.action}`);
    return false;
  } catch (error) {
    await updateCommand(config, command, "failed", error && error.message ? error.message : String(error));
    return false;
  }
}

async function tick(options = {}) {
  const config = getConfig();
  const status = await postStatus(config);
  log("status synced", {
    qi: status.services.qiBridge.online,
    ccgram: status.services.ccgramBridge.online
  });
  if (!options.noControl && config.controlUrl) {
    const response = await httpRequestJson(config.controlUrl, {
      method: "GET",
      timeoutMs: 15000,
      headers: {
        Accept: "application/json",
        "X-Memory-Sync-Token": config.syncToken,
        "X-Memory-Client": "codex-status-agent"
      }
    });
    const command = response.data && response.data.command ? response.data.command : null;
    if (command && command.status === "queued") {
      await executeCommand(config, command);
    }
  }
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
    await tick({ noControl });
    return;
  }
  await tick({ noControl }).catch((error) => log("tick failed", error && error.message ? error.message : String(error)));
  setInterval(() => {
    tick({ noControl }).catch((error) => log("tick failed", error && error.message ? error.message : String(error)));
  }, STATUS_INTERVAL_MS);
}

main().catch((error) => {
  log("fatal", error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
