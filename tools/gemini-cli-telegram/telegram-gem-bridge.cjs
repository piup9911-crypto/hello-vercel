const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  INDEPENDENT_MEMORY_FILE_NAME,
  syncSharedMemory
} = require("./shared-memory-sync.cjs");

const VERSION = "0.3.0";
const ROOT = __dirname;
const REAL_HOME = os.homedir();
const SOURCE_GEMINI_DIR = path.join(REAL_HOME, ".gemini");
const BRIDGE_HOME = path.join(ROOT, "bridge-home");
const BRIDGE_GEMINI_DIR = path.join(BRIDGE_HOME, ".gemini");
const BRIDGE_WORKSPACE = path.join(ROOT, "bridge-workspace");
const BRIDGE_STATE_DIR = path.join(ROOT, "bridge-state");
const CHAT_STATE_DIR = path.join(BRIDGE_STATE_DIR, "chats");
const BRIDGE_LOG_PATH = path.join(BRIDGE_STATE_DIR, "bridge.log");
const BRIDGE_LOCK_PATH = path.join(BRIDGE_STATE_DIR, "bridge.lock.json");
const BRIDGE_ENV_PATH = path.join(ROOT, "bridge.env");
const SHARED_MEMORY_CACHE_PATH = path.join(
  BRIDGE_STATE_DIR,
  "shared-memory-cache.json"
);
const CLI_WORKSPACE = path.join(REAL_HOME, "gemini-test");
const HOME_PERSONA_PATH = path.join(SOURCE_GEMINI_DIR, "GEMINI.md");
const CLI_PERSONA_PATH = path.join(CLI_WORKSPACE, "GEMINI.md");
const TELEGRAM_PERSONA_PATH = path.join(BRIDGE_WORKSPACE, "GEMINI.md");
const TELEGRAM_MEMORY_PATH = path.join(
  BRIDGE_WORKSPACE,
  INDEPENDENT_MEMORY_FILE_NAME
);
const APPDATA_DIR =
  process.env.APPDATA || path.join(REAL_HOME, "AppData", "Roaming");
const TELEGRAM_PACKAGE_ROOT = path.join(
  APPDATA_DIR,
  "npm",
  "node_modules",
  "mcp-communicator-telegram"
);
const GEMINI_BUNDLE_PATH = path.join(
  APPDATA_DIR,
  "npm",
  "node_modules",
  "@google",
  "gemini-cli",
  "bundle",
  "gemini.js"
);

const requireFromTelegramPackage = (name) =>
  require(path.join(TELEGRAM_PACKAGE_ROOT, "node_modules", name));

const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 12000;
const DEFAULT_QUALITY_MODEL =
  process.env.BRIDGE_GEMINI_MODEL_QUALITY ||
  process.env.BRIDGE_GEMINI_MODEL ||
  "gemini-3.1-pro-preview";
const DEFAULT_FAST_MODEL =
  process.env.BRIDGE_GEMINI_MODEL_FAST || "gemini-2.5-flash";
const OFFICIAL_MODEL_ALIASES = ["auto", "pro", "flash", "flash-lite"];
const OFFICIAL_CONCRETE_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview"
];
const GEMINI_TIMEOUT_MS = Math.max(
  30000,
  Number.parseInt(process.env.BRIDGE_GEMINI_TIMEOUT_MS || "180000", 10) || 180000
);
const SHARED_MEMORY_REFRESH_MS = Math.max(
  60000,
  Number.parseInt(process.env.BRIDGE_SHARED_MEMORY_REFRESH_MS || "300000", 10) ||
    300000
);
// Memory ingest is intentionally delayed. The user asked for "10 completed
// dialogue rounds, then 2 minutes idle" instead of summarizing every reply.
// Keep these knobs together so future edits do not accidentally restore the
// old too-eager memory-writing behavior.
const MEMORY_INGEST_IDLE_MS = Math.max(
  15000,
  Number.parseInt(process.env.BRIDGE_MEMORY_INGEST_IDLE_MS || "120000", 10) ||
    120000
);
const MEMORY_INGEST_TURN_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.BRIDGE_MEMORY_INGEST_TURN_THRESHOLD || "10", 10) ||
    10
);
const STREAM_PREVIEW_UPDATE_MS = Math.max(
  250,
  Number.parseInt(process.env.BRIDGE_STREAM_PREVIEW_UPDATE_MS || "900", 10) || 900
);
const SHARED_MEMORY_PAGE_URL =
  process.env.SHARED_MEMORY_PAGE_URL ||
  "https://hello-vercel-blush-eight.vercel.app/memory.html";
const COMMAND_PREFIXES = [
  "/start",
  "/menu",
  "/help",
  "/reset",
  "/status",
  "/memory",
  "/thinking",
  "/model"
];
const MENU_LABELS = {
  main: "主菜单",
  model: "切换模型",
  memory: "记忆系统",
  personaMemory: "人格记忆",
  dailyMemory: "日常记忆",
  status: "查看状态",
  thinking: "思路摘要",
  reset: "重置对话",
  help: "帮助",
  back: "返回主菜单",
  hide: "收起菜单"
};
const MODEL_MENU_BUTTONS = [
  "auto",
  "pro",
  "flash",
  "flash-lite",
  "quality",
  "fast",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview"
];
const memoryIngestCooldowns = new Map();
const memoryIngestTimers = new Map();
let bridgeLockHeld = false;
const THINKING_MODE_ALIASES = new Map([
  ["on", "hidden"],
  ["off", "off"],
  ["hidden", "hidden"],
  ["hide", "hidden"],
  ["spoiler", "hidden"],
  ["visible", "visible"],
  ["show", "visible"],
  ["open", "visible"],
  ["开", "hidden"],
  ["关", "off"],
  ["隐藏", "hidden"],
  ["显示", "visible"]
]);

function log(...args) {
  ensureDir(BRIDGE_STATE_DIR);
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
  const stamped = `[${new Date().toISOString()}] ${line}`;
  try {
    fs.appendFileSync(BRIDGE_LOG_PATH, `${stamped}\n`, "utf8");
  } catch {}
  process.stderr.write(`[bridge] ${stamped}\n`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

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

loadEnvFile(path.join(SOURCE_GEMINI_DIR, ".env"), false);
loadEnvFile(BRIDGE_ENV_PATH, true);

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || "";
const ALLOWED_CHAT_IDS = (
  process.env.TELEGRAM_ALLOWED_CHAT_IDS ||
  process.env.TELEGRAM_CHAT_ID ||
  process.env.CHAT_ID ||
  ""
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!TELEGRAM_TOKEN) {
  throw new Error(
    "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_TOKEN. Put it in ~/.gemini/.env or bridge.env."
  );
}

function printHelp() {
  process.stdout.write(
    [
      "telegram-gem-bridge",
      "",
      "Usage:",
      "  node telegram-gem-bridge.cjs",
      "  node telegram-gem-bridge.cjs --healthcheck",
      "  node telegram-gem-bridge.cjs --version",
      "",
      "Commands inside Telegram:",
      "  /start   show intro",
      "  /menu    show the main menu",
      "  /help    show commands",
      "  /memory  open the memory submenu",
      "  /model auto|pro|flash|flash-lite|gemini-...",
      "  /thinking off|hidden|visible",
      "  /reset   clear this chat history",
      "  /status  show bridge status",
      ""
    ].join("\n")
  );
}

function ensureBridgeHome() {
  ensureDir(BRIDGE_GEMINI_DIR);
  ensureDir(BRIDGE_WORKSPACE);
  ensureDir(CHAT_STATE_DIR);

  const requiredCopy = ["oauth_creds.json"];
  const optionalCopy = [
    "google_accounts.json",
    "installation_id",
    "state.json",
    "GEMINI.md"
  ];

  for (const name of [...requiredCopy, ...optionalCopy]) {
    const source = path.join(SOURCE_GEMINI_DIR, name);
    const target = path.join(BRIDGE_GEMINI_DIR, name);
    if (!fs.existsSync(source)) {
      if (requiredCopy.includes(name) && !process.env.GEMINI_API_KEY) {
        throw new Error(
          `Missing ${source}. Run Gemini CLI locally first or provide GEMINI_API_KEY.`
        );
      }
      continue;
    }
    fs.copyFileSync(source, target);
  }

  const settings = {
    security: {
      auth: {
        selectedType: process.env.GEMINI_API_KEY ? "gemini-api-key" : "oauth-personal"
      }
    },
    general: {
      sessionRetention: {
        enabled: false,
        maxAge: "30d"
      }
    },
    ui: {
      autoThemeSwitching: false,
      showModelInfoInChat: true
    },
    output: {
      format: "json"
    },
    mcpServers: {}
  };

  writeJson(path.join(BRIDGE_GEMINI_DIR, "settings.json"), settings);
  writeJson(path.join(BRIDGE_GEMINI_DIR, "trustedFolders.json"), {
    [BRIDGE_WORKSPACE]: "TRUST_FOLDER"
  });
  writeJson(path.join(BRIDGE_GEMINI_DIR, "projects.json"), {
    projects: {
      [BRIDGE_WORKSPACE.toLowerCase()]: "telegram-bridge"
    }
  });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireBridgeLock() {
  ensureDir(BRIDGE_STATE_DIR);
  const existing = readJson(BRIDGE_LOCK_PATH, null);
  if (
    existing &&
    existing.pid !== process.pid &&
    isProcessAlive(existing.pid)
  ) {
    throw new Error(
      `Another telegram-gem-bridge instance is already running (pid ${existing.pid}).`
    );
  }

  writeJson(BRIDGE_LOCK_PATH, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    script: "telegram-gem-bridge.cjs"
  });
  bridgeLockHeld = true;
}

function releaseBridgeLock() {
  if (!bridgeLockHeld) {
    return;
  }

  const existing = readJson(BRIDGE_LOCK_PATH, null);
  if (!existing || existing.pid === process.pid) {
    try {
      fs.unlinkSync(BRIDGE_LOCK_PATH);
    } catch {}
  }
  bridgeLockHeld = false;
}

function readSharedMemoryStatus() {
  return readJson(SHARED_MEMORY_CACHE_PATH, null);
}

async function refreshSharedMemory(force = false) {
  const cached = readSharedMemoryStatus();
  if (!force && cached && cached.syncedAt) {
    const ageMs = Date.now() - new Date(cached.syncedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs < SHARED_MEMORY_REFRESH_MS) {
      return {
        ok: true,
        skipped: true,
        reason: "Shared memory sync is still fresh.",
        updatedAt: cached.updatedAt,
        writtenFiles: cached.targets || []
      };
    }
  }

  try {
    const result = await syncSharedMemory({
      cachePath: SHARED_MEMORY_CACHE_PATH,
      targets: [BRIDGE_WORKSPACE, CLI_WORKSPACE],
      clientName: "telegram-gem-bridge"
    });
    log("shared memory sync result", result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      skipped: false,
      reason: error && error.message ? error.message : String(error)
    };
    log("shared memory sync failed", result);
    return result;
  }
}

function readIndependentMemoryText() {
  return readText(TELEGRAM_MEMORY_PATH, "").trim();
}

function injectIndependentMemory(lines) {
  const memoryText = readIndependentMemoryText();
  if (!memoryText) {
    return lines;
  }

  return [
    ...lines,
    "",
    "Independent memory for this conversation:",
    memoryText
  ];
}

function getChatStatePath(chatId) {
  return path.join(CHAT_STATE_DIR, `${chatId}.json`);
}

function loadChatState(chatId) {
  return readJson(getChatStatePath(chatId), {
    chatId,
    history: [],
    sessionId: null,
    thinkingMode: "hidden",
    modelMode: "quality",
    customModel: null,
    // Telegram memory ingest should happen only after enough full dialogue has
    // accumulated. One completed turn = one user message that already got an
    // assistant reply. This keeps the old bridge from summarizing every idle
    // pause and matches the user's "10 rounds, then 2 minutes idle" rule.
    completedTurnsSinceMemoryIngest: 0,
    lastMemoryIngestAt: "",
    updatedAt: new Date().toISOString()
  });
}

function saveChatState(chatState) {
  chatState.updatedAt = new Date().toISOString();
  writeJson(getChatStatePath(chatState.chatId), chatState);
}

function resetChatState(chatId) {
  const statePath = getChatStatePath(chatId);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

function buildInitialPrompt(latestUserMessage, options) {
  const allowNativeThinking = Boolean(
    options && options.allowNativeThinking
  );
  const lines = injectIndependentMemory([
    "You are chatting with the user through Telegram instead of the terminal.",
    "Keep the tone and intelligence close to Gemini CLI.",
    "Default to Chinese when the user speaks Chinese.",
    "Keep replies readable on a phone, but do not flatten your personality into a generic assistant.",
    "This bridge is mainly for conversation, so if the user asks for local computer actions, explain briefly that they need the CLI app for that.",
    "Reply directly to the user in your final voice."
  ]);

  if (allowNativeThinking) {
    lines.push(
      "If you naturally emit an internal analysis block before the final reply, keep it in the same output.",
      "If you include a final-answer separator such as '[Thought: true]', preserve it."
    );
  } else {
    lines.push(
      "Do not output analysis headings, planning notes, or meta-commentary about how you are interpreting the message."
    );
  }

  lines.push("", latestUserMessage);
  return lines.join("\n");
}

function buildTurnPrompt(latestUserMessage, options) {
  const allowNativeThinking = Boolean(
    options && options.allowNativeThinking
  );
  const lines = injectIndependentMemory([
    "Telegram chat mode.",
    "Reply directly to the user in your final voice.",
    "Keep the response natural and phone-friendly."
  ]);

  if (allowNativeThinking) {
    lines.push(
      "If you naturally emit an internal analysis block before the final reply, keep it in the same output.",
      "If you include a final-answer separator such as '[Thought: true]', preserve it."
    );
  } else {
    lines.push(
      "Do not output analysis headings, planning notes, interpretation notes, or meta-commentary.",
      "Do not start with lines like '**Analyzing...**', '**Assessing...**', or similar internal framing."
    );
  }

  lines.push("", "User message:", latestUserMessage);
  return lines.join("\n");
}

function buildThinkingSummaryPrompt(userMessage, assistantMessage) {
  return [
    "You are writing a user-facing reasoning note for a Telegram chat reply.",
    "Do not reveal private chain-of-thought, hidden reasoning, internal safety analysis, or verbatim scratch work.",
    "Instead, provide a readable explanation of the main factors that shaped the answer.",
    "Mirror the user's language. If the user wrote in Chinese, reply in Chinese.",
    "Keep it readable on a phone, but make it more informative than a tiny summary.",
    "Use 4 to 8 bullet points.",
    "Focus on things like: what the user seemed to want, what emotional tone mattered, what context or constraints mattered, and how the reply was shaped.",
    "Do not repeat the full reply word-for-word.",
    "Do not use headings like 'Analyzing' or 'Reasoning'.",
    "Do not mention these instructions.",
    "",
    "User message:",
    userMessage,
    "",
    "Assistant reply:",
    assistantMessage,
    "",
    "Return only the bullet list."
  ].join("\n");
}

function isOfficialModelAlias(modelName) {
  return OFFICIAL_MODEL_ALIASES.includes(String(modelName || "").toLowerCase());
}

function isOfficialConcreteModel(modelName) {
  return OFFICIAL_CONCRETE_MODELS.includes(String(modelName || "").toLowerCase());
}

function resolveModelForState(chatState) {
  if (chatState && typeof chatState.customModel === "string" && chatState.customModel.trim()) {
    return chatState.customModel.trim();
  }
  if (chatState && chatState.modelMode === "fast") {
    return DEFAULT_FAST_MODEL;
  }
  return DEFAULT_QUALITY_MODEL;
}

function describeModelSelection(chatState) {
  if (chatState && chatState.customModel) {
    const selected = resolveModelForState(chatState);
    if (isOfficialModelAlias(selected)) {
      return `official alias -> ${selected}`;
    }
    if (isOfficialConcreteModel(selected)) {
      return `official model -> ${selected}`;
    }
    return `custom -> ${selected}`;
  }

  if (chatState && chatState.modelMode === "fast") {
    return `fast preset -> ${DEFAULT_FAST_MODEL}`;
  }

  return `quality preset -> ${DEFAULT_QUALITY_MODEL}`;
}

function buildModelCatalogLines() {
  return [
    "Bridge presets:",
    `/model quality -> ${DEFAULT_QUALITY_MODEL}`,
    `/model fast -> ${DEFAULT_FAST_MODEL}`,
    "",
    "Official Gemini CLI aliases:",
    "/model auto",
    "/model pro",
    "/model flash",
    "/model flash-lite",
    "",
    "Official Gemini CLI model names:",
    "/model gemini-2.5-pro",
    "/model gemini-2.5-flash",
    "/model gemini-2.5-flash-lite",
    "/model gemini-3-pro-preview",
    "/model gemini-3-flash-preview",
    "/model gemini-3.1-pro-preview",
    "/model gemini-3.1-flash-lite-preview",
    "",
    "Notes:",
    "- Some preview models only appear if your account has access.",
    "- auto/pro/flash/flash-lite are official Gemini CLI aliases.",
    "- quality/fast are bridge compatibility presets."
  ];
}

function buildReplyKeyboard(rows, options) {
  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder:
        options && options.placeholder ? options.placeholder : "直接发消息聊天，或点下面的菜单按钮"
    }
  };
}

function buildMainMenuKeyboard() {
  return buildReplyKeyboard(
    [
      [MENU_LABELS.model, MENU_LABELS.memory],
      [MENU_LABELS.status, MENU_LABELS.thinking],
      [MENU_LABELS.reset, MENU_LABELS.help],
      [MENU_LABELS.hide]
    ],
    { placeholder: "主菜单：切换模型、查看记忆，或直接聊天" }
  );
}

function buildModelMenuKeyboard() {
  return buildReplyKeyboard(
    [
      ["auto", "pro"],
      ["flash", "flash-lite"],
      ["quality", "fast"],
      ["gemini-2.5-pro"],
      ["gemini-2.5-flash"],
      ["gemini-2.5-flash-lite"],
      ["gemini-3-pro-preview"],
      ["gemini-3-flash-preview"],
      ["gemini-3.1-pro-preview"],
      ["gemini-3.1-flash-lite-preview"],
      [MENU_LABELS.back]
    ],
    { placeholder: "点一个模型就会切换，下条消息生效" }
  );
}

function buildMemoryMenuKeyboard() {
  return buildReplyKeyboard(
    [
      [MENU_LABELS.personaMemory, MENU_LABELS.dailyMemory],
      [MENU_LABELS.back]
    ],
    { placeholder: "查看人格记忆或日常记忆" }
  );
}

function buildHiddenMenuKeyboard() {
  return {
    reply_markup: {
      remove_keyboard: true
    }
  };
}

function truncateForPreview(text, maxChars = 240) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "当前为空。";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function formatTimeOrFallback(value, fallback) {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toLocaleString("zh-CN", {
    hour12: false
  });
}

async function sendMainMenu(bot, chatId, chatState) {
  const state = chatState || loadChatState(chatId);
  await bot.sendMessage(
    chatId,
    [
      "主菜单",
      "",
      `当前模型：${describeModelSelection(state)}`,
      "你可以直接点下面的按钮，也可以继续直接发消息聊天。"
    ].join("\n"),
    buildMainMenuKeyboard()
  );
}

async function sendModelMenu(bot, chatId, chatState) {
  const state = chatState || loadChatState(chatId);
  await bot.sendMessage(
    chatId,
    [
      "切换模型",
      "",
      `当前：${describeModelSelection(state)}`,
      "点一个模型就会切换；从下一条消息开始生效。",
      "",
      "上半区是官方 CLI 别名，下半区是官方模型名；`quality` 和 `fast` 是桥接预设。"
    ].join("\n"),
    buildModelMenuKeyboard()
  );
}

async function sendMemoryMenu(bot, chatId) {
  await bot.sendMessage(
    chatId,
    [
      "记忆系统",
      "",
      "这里分成两层：",
      "1. 人格记忆：身份、语气、长期设定",
      "2. 日常记忆：共同经历、日常梗、云端共享记忆"
    ].join("\n"),
    buildMemoryMenuKeyboard()
  );
}

async function sendPersonaMemoryInfo(bot, chatId) {
  await bot.sendMessage(
    chatId,
    [
      "人格记忆",
      "",
      "这部分决定你在 Telegram 里遇到的是怎样的她：语气、关系感、长期人格。",
      "",
      `主人格源：${HOME_PERSONA_PATH}`,
      `普通 CLI 使用：${CLI_PERSONA_PATH}`,
      `Telegram 使用：${TELEGRAM_PERSONA_PATH}`,
      "",
      "Telegram 版会基于主人格裁掉偏代码/工具调用的提示词，所以更适合日常聊天。"
    ].join("\n"),
    buildMemoryMenuKeyboard()
  );
}

async function sendDailyMemoryInfo(bot, chatId) {
  const sharedMemory = readSharedMemoryStatus();
  await bot.sendMessage(
    chatId,
    [
      "日常记忆",
      "",
      "这部分保存你们共同经历、好玩的事、关系变化和长期有效的生活上下文。",
      "",
      `最近同步：${formatTimeOrFallback(
        sharedMemory && sharedMemory.syncedAt,
        "还没有同步记录"
      )}`,
      `已确认条目：${
        sharedMemory && Number.isFinite(sharedMemory.approvedEntryCount)
          ? sharedMemory.approvedEntryCount
          : 0
      }`,
      `待确认条目：${
        sharedMemory && Number.isFinite(sharedMemory.pendingEntryCount)
          ? sharedMemory.pendingEntryCount
          : 0
      }`,
      "",
      `当前摘要：${truncateForPreview(sharedMemory && sharedMemory.content)}`,
      "",
      `网页查看与审核：${SHARED_MEMORY_PAGE_URL}`
    ].join("\n"),
    buildMemoryMenuKeyboard()
  );
}

function parseModelSelection(text) {
  const parts = text.trim().split(/\s+/).slice(1);
  if (parts.length === 0) {
    return { kind: "status" };
  }

  const raw = parts.join(" ").trim();
  const normalized = raw.toLowerCase();
  if (!raw) {
    return { kind: "status" };
  }
  if (normalized === "fast") {
    return { kind: "preset", mode: "fast" };
  }
  if (normalized === "quality" || normalized === "default") {
    return { kind: "preset", mode: "quality" };
  }
  if (normalized === "current" || normalized === "status") {
    return { kind: "status" };
  }
  if (normalized === "list" || normalized === "help") {
    return { kind: "status" };
  }
  if (normalized === "reset") {
    return { kind: "preset", mode: "quality" };
  }
  return { kind: "custom", model: raw };
}

async function applyModelSelection(bot, chatId, state, selection) {
  if (selection.kind === "preset") {
    state.modelMode = selection.mode;
    state.customModel = null;
    state.sessionId = null;
    saveChatState(state);
    await bot.sendMessage(
      chatId,
      `模型已切换为 ${describeModelSelection(
        state
      )}。会从下一条消息开始生效。`,
      buildModelMenuKeyboard()
    );
    return;
  }

  state.modelMode = "custom";
  state.customModel = selection.model;
  state.sessionId = null;
  saveChatState(state);
  await bot.sendMessage(
    chatId,
    `模型已切换为 ${describeModelSelection(
      state
    )}。会从下一条消息开始生效。`,
    buildModelMenuKeyboard()
  );
}

function getRawGeminiText(parsed, stdout, stderr) {
  if (parsed && typeof parsed.response === "string" && parsed.response.trim()) {
    return parsed.response.trim();
  }
  const stdoutText = stdout.trim();
  if (stdoutText) {
    return stdoutText;
  }
  const stderrText = stderr.trim();
  if (stderrText) {
    return stderrText;
  }
  return "";
}

function splitNativeThinkingAndReply(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return {
      rawText: "",
      thinkingText: null,
      replyText: ""
    };
  }

  const thoughtMarkerRegex = /\[Thought:\s*true\]/gi;
  const markerMatches = Array.from(normalized.matchAll(thoughtMarkerRegex));
  if (markerMatches.length >= 2) {
    const firstMatch = markerMatches[0];
    const lastMatch = markerMatches[markerMatches.length - 1];
    const firstMarkerIndex = firstMatch.index ?? 0;
    const firstMarkerLength = firstMatch[0].length;
    const lastMarkerIndex = lastMatch.index ?? firstMarkerIndex;
    const lastMarkerLength = lastMatch[0].length;
    const thinkingText = normalized
      .slice(firstMarkerIndex + firstMarkerLength, lastMarkerIndex)
      .trim();
    const replyText = normalized
      .slice(lastMarkerIndex + lastMarkerLength)
      .trim();
    return {
      rawText: normalized,
      thinkingText: thinkingText || null,
      replyText: replyText || sanitizeAssistantReply(normalized)
    };
  }

  const thoughtMarkerMatch = markerMatches[0] || null;
  if (thoughtMarkerMatch) {
    const markerIndex = thoughtMarkerMatch.index ?? 0;
    const markerLength = thoughtMarkerMatch[0].length;
    if (markerIndex > 0) {
      const thinkingText = normalized.slice(0, markerIndex).trim();
      const replyText = normalized.slice(markerIndex + markerLength).trim();
      return {
        rawText: normalized,
        thinkingText: thinkingText || null,
        replyText: replyText || sanitizeAssistantReply(normalized)
      };
    }

    const replyOnlyText = normalized.slice(markerIndex + markerLength).trim();
    return {
      rawText: normalized,
      thinkingText: null,
      replyText: replyOnlyText || sanitizeAssistantReply(normalized)
    };
  }

  return {
    rawText: normalized,
    thinkingText: null,
    replyText: sanitizeAssistantReply(normalized)
  };
}

function extractGeminiTextParts(parsed, stdout, stderr) {
  return splitNativeThinkingAndReply(getRawGeminiText(parsed, stdout, stderr));
}

function countThoughtMarkers(text) {
  return Array.from(
    String(text || "").matchAll(/\[Thought:\s*true\]/gi)
  ).length;
}

function extractTextFromStructuredContent(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractTextFromStructuredContent(item)).join("");
  }
  if (typeof value !== "object") {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  if (Array.isArray(value.parts)) {
    return value.parts.map((item) => extractTextFromStructuredContent(item)).join("");
  }
  if (Array.isArray(value.content)) {
    return value.content.map((item) => extractTextFromStructuredContent(item)).join("");
  }
  return "";
}

function extractAssistantStreamText(event) {
  if (!event || event.type !== "message") {
    return "";
  }
  if (event.role && event.role !== "assistant") {
    return "";
  }

  const directText = extractTextFromStructuredContent(event.content);
  if (directText) {
    return directText;
  }

  const messageText = extractTextFromStructuredContent(event.message);
  if (messageText) {
    return messageText;
  }

  if (typeof event.text === "string") {
    return event.text;
  }

  return "";
}

function mergeGeminiStreamText(currentText, nextText, isDelta) {
  const incoming = String(nextText || "");
  if (!incoming) {
    return currentText;
  }
  if (!currentText) {
    return incoming;
  }
  if (isDelta) {
    return currentText + incoming;
  }
  if (incoming.startsWith(currentText)) {
    return incoming;
  }
  if (currentText.endsWith(incoming)) {
    return currentText;
  }
  return currentText + incoming;
}

function extractStreamingReplyPreview(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const thoughtMarkerRegex = /\[Thought:\s*true\]/gi;
  const markerMatches = Array.from(normalized.matchAll(thoughtMarkerRegex));
  if (markerMatches.length >= 2) {
    const lastMatch = markerMatches[markerMatches.length - 1];
    const lastMarkerIndex = lastMatch.index ?? 0;
    const lastMarkerLength = lastMatch[0].length;
    return normalized.slice(lastMarkerIndex + lastMarkerLength).trim();
  }

  if (markerMatches.length === 1) {
    const match = markerMatches[0];
    const markerIndex = match.index ?? 0;
    const markerLength = match[0].length;
    if (markerIndex === 0) {
      return "";
    }
    return normalized.slice(markerIndex + markerLength).trim();
  }

  const firstParagraph = normalized.split(/\n\s*\n/, 1)[0] || "";
  const firstLine = normalized.split("\n", 1)[0] || "";
  if (
    looksLikeMetaAnalysisHeading(firstLine) ||
    looksLikeMetaAnalysisParagraph(firstParagraph)
  ) {
    return "";
  }

  return sanitizeAssistantReply(normalized);
}

function normalizeGeminiText(parsed, stdout, stderr) {
  const parts = extractGeminiTextParts(parsed, stdout, stderr);
  if (parts.replyText) {
    return parts.replyText;
  }
  if (parts.rawText) {
    return parts.rawText;
  }
  return "No response returned.";
}

function looksLikeMetaAnalysisHeading(line) {
  const normalized = String(line || "").trim();
  if (!normalized) return false;
  return /^\*\*(Analyzing|Assessing|Understanding|Reviewing|Parsing|Considering|Thinking|Interpreting|Evaluating|Responding)\b/i.test(
    normalized
  );
}

function looksLikeMetaAnalysisParagraph(paragraph) {
  const normalized = String(paragraph || "").trim();
  if (!normalized) return false;
  return (
    /^(The user|This response|This reply|I'?m currently|I am currently|I should|This suggests|This indicates|This means|The message|The user responded)/i.test(
      normalized
    ) ||
    looksLikeMetaAnalysisHeading(normalized.split("\n", 1)[0] || "")
  );
}

function sanitizeAssistantReply(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const paragraphs = normalized
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (paragraphs.length >= 2 && looksLikeMetaAnalysisParagraph(paragraphs[0])) {
    return paragraphs.slice(1).join("\n\n").trim();
  }

  const lines = normalized.split("\n");
  if (lines.length >= 3 && looksLikeMetaAnalysisHeading(lines[0])) {
    let index = 1;
    while (index < lines.length && !lines[index].trim()) {
      index += 1;
    }
    while (index < lines.length && lines[index].trim()) {
      index += 1;
    }
    const cleaned = lines.slice(index).join("\n").trim();
    if (cleaned) {
      return cleaned;
    }
  }

  return normalized;
}

function callGemini(prompt, sessionId, modelId) {
  return new Promise((resolve, reject) => {
    const childEnv = {
      ...process.env,
      USERPROFILE: BRIDGE_HOME,
      HOME: BRIDGE_HOME,
      GEMINI_CLI_TRUSTED_FOLDERS_PATH: path.join(
        BRIDGE_GEMINI_DIR,
        "trustedFolders.json"
      )
    };

    const args = [
      GEMINI_BUNDLE_PATH,
      "-m",
      modelId,
      "--approval-mode",
      "plan"
    ];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push(
      "--prompt",
      "",
      "-o",
      "json"
    );

    const child = spawn(process.execPath, args, {
      cwd: BRIDGE_WORKSPACE,
      env: childEnv,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error(
          `Gemini timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)} seconds.`
        )
      );
    }, GEMINI_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(prompt, "utf8");
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      log("gemini child process error", error.message);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const stdoutText = stdout.trim();
      let parsed = null;
      if (stdoutText) {
        try {
          parsed = JSON.parse(stdoutText);
        } catch {
          parsed = null;
        }
      }

      // [BUG-T2 FIX] 修正缩进，让 log/reject 明确位于 if 块内
      if (code !== 0) {
        const details = stderr.trim() || stdoutText || `exit code ${code}`;
        log("gemini call failed", { code, details });
        reject(new Error(details));
        return;
      }

      const textParts = extractGeminiTextParts(parsed, stdout, stderr);
      log("gemini call succeeded", {
        model: modelId,
        sessionId: parsed && parsed.session_id ? parsed.session_id : null,
        thoughtMarkerCount: countThoughtMarkers(textParts.rawText),
        hasNativeThinking: Boolean(textParts.thinkingText),
        responsePreview: (textParts.replyText || textParts.rawText || "").slice(0, 120)
      });
      resolve({
        sessionId: parsed && parsed.session_id ? parsed.session_id : sessionId || null,
        text: textParts.replyText || textParts.rawText || "No response returned.",
        thinkingText: textParts.thinkingText,
        rawText: textParts.rawText,
        parsed,
        stderr: stderr.trim()
      });
    });
  });
}

function callGeminiStream(prompt, sessionId, modelId, onReplyPreview) {
  return new Promise((resolve, reject) => {
    const childEnv = {
      ...process.env,
      USERPROFILE: BRIDGE_HOME,
      HOME: BRIDGE_HOME,
      GEMINI_CLI_TRUSTED_FOLDERS_PATH: path.join(
        BRIDGE_GEMINI_DIR,
        "trustedFolders.json"
      )
    };

    const args = [
      GEMINI_BUNDLE_PATH,
      "-m",
      modelId,
      "--approval-mode",
      "plan"
    ];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push(
      "--prompt",
      "",
      "-o",
      "stream-json"
    );

    const child = spawn(process.execPath, args, {
      cwd: BRIDGE_WORKSPACE,
      env: childEnv,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let settled = false;
    let parsedResult = null;
    let latestSessionId = sessionId || null;
    let rawAssistantText = "";
    let lastPreviewText = "";
    let lastPreviewAt = 0;

    const emitPreview = (force) => {
      if (typeof onReplyPreview !== "function") {
        return;
      }
      const previewText = extractStreamingReplyPreview(rawAssistantText);
      // [BUG-T3 FIX] 删除了下面两个已被 !force 分支完整覆盖的死代码守卫
      if (!force) {
        if (!previewText || previewText === lastPreviewText) {
          return;
        }
        if (Date.now() - lastPreviewAt < STREAM_PREVIEW_UPDATE_MS) {
          return;
        }
      }
      lastPreviewText = previewText;
      lastPreviewAt = Date.now();
      Promise.resolve(onReplyPreview(previewText)).catch((error) => {
        log("stream preview callback failed", error.message);
      });
    };

    const handleStreamEvent = (event) => {
      if (!event || typeof event !== "object") {
        return;
      }

      latestSessionId =
        event.session_id ||
        event.sessionId ||
        (event.result && (event.result.session_id || event.result.sessionId)) ||
        latestSessionId;

      if (event.type === "result") {
        parsedResult = event;
      }

      const nextText = extractAssistantStreamText(event);
      if (!nextText) {
        return;
      }

      rawAssistantText = mergeGeminiStreamText(
        rawAssistantText,
        nextText,
        event.delta === true
      );
      emitPreview(false);
    };

    const flushLineBuffer = () => {
      const trailing = lineBuffer.trim();
      if (!trailing) {
        return;
      }
      lineBuffer = "";
      try {
        handleStreamEvent(JSON.parse(trailing));
      } catch {}
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error(
          `Gemini timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)} seconds.`
        )
      );
    }, GEMINI_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      lineBuffer += chunk;
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (rawLine) {
          try {
            handleStreamEvent(JSON.parse(rawLine));
          } catch {}
        }
        newlineIndex = lineBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(prompt, "utf8");
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      log("gemini stream child process error", error.message);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      flushLineBuffer();

      if (code !== 0) {
        const details = stderr.trim() || stdout.trim() || `exit code ${code}`;
        log("gemini stream call failed", { code, details });
        reject(new Error(details));
        return;
      }

      emitPreview(true);
      const textParts = rawAssistantText
        ? splitNativeThinkingAndReply(rawAssistantText)
        : extractGeminiTextParts(parsedResult, stdout, stderr);
      log("gemini stream call succeeded", {
        model: modelId,
        sessionId: latestSessionId,
        thoughtMarkerCount: countThoughtMarkers(textParts.rawText),
        hasNativeThinking: Boolean(textParts.thinkingText),
        responsePreview: (textParts.replyText || textParts.rawText || "").slice(0, 120)
      });
      resolve({
        sessionId: latestSessionId,
        text: textParts.replyText || textParts.rawText || "No response returned.",
        thinkingText: textParts.thinkingText,
        rawText: textParts.rawText,
        parsed: parsedResult,
        stderr: stderr.trim()
      });
    });
  });
}

function splitMessage(text, size = 3500) {
  if (text.length <= size) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > size) {
    let sliceAt = remaining.lastIndexOf("\n", size);
    if (sliceAt < size * 0.5) {
      sliceAt = size;
    }
    chunks.push(remaining.slice(0, sliceAt).trim());
    remaining = remaining.slice(sliceAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

async function sendLongMessage(bot, chatId, text, extraOptions) {
  const parts = splitMessage(text);
  log("sending telegram reply parts", {
    chatId,
    partCount: parts.length
  });
  for (const part of parts) {
    await sendMessageWithTimeout(bot, chatId, part, extraOptions);
  }
}

function commandOf(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const firstToken = trimmed.split(/\s+/, 1)[0] || "";
  const normalized = firstToken.replace(/@[^@\s]+$/, "");
  return COMMAND_PREFIXES.includes(normalized) ? normalized : null;
}

function menuActionOf(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return null;
  }

  if (normalized === MENU_LABELS.main || normalized === MENU_LABELS.back) {
    return { kind: "main-menu" };
  }
  if (normalized === MENU_LABELS.model) {
    return { kind: "model-menu" };
  }
  if (normalized === MENU_LABELS.memory) {
    return { kind: "memory-menu" };
  }
  if (normalized === MENU_LABELS.personaMemory) {
    return { kind: "persona-memory" };
  }
  if (normalized === MENU_LABELS.dailyMemory) {
    return { kind: "daily-memory" };
  }
  if (normalized === MENU_LABELS.status) {
    return { kind: "status" };
  }
  if (normalized === MENU_LABELS.thinking) {
    return { kind: "thinking" };
  }
  if (normalized === MENU_LABELS.reset) {
    return { kind: "reset" };
  }
  if (normalized === MENU_LABELS.help) {
    return { kind: "help" };
  }
  if (normalized === MENU_LABELS.hide) {
    return { kind: "hide-menu" };
  }
  if (MODEL_MENU_BUTTONS.includes(normalized)) {
    return { kind: "model-selection", value: normalized };
  }

  return null;
}

function parseThinkingMode(text) {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;
  const rawMode = (parts[1] || "").toLowerCase();
  return THINKING_MODE_ALIASES.get(rawMode) || null;
}

function clearScheduledMemoryIngest(chatId) {
  const timer = memoryIngestTimers.get(chatId);
  if (timer) {
    clearTimeout(timer);
    memoryIngestTimers.delete(chatId);
  }
}

function describeThinkingMode(mode) {
  if (mode === "hidden") {
    return "默认折叠";
  }
  if (mode === "visible") {
    return "直接展开";
  }
  return "关闭";
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isMessageNotModifiedError(error) {
  return /message is not modified/i.test(
    error && error.message ? error.message : String(error)
  );
}

function sendMessageWithTimeout(bot, chatId, text, options) {
  return Promise.race([
    bot.sendMessage(chatId, text, options),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Telegram sendMessage timed out after 30 seconds."));
      }, 30000);
    })
  ]);
}

function editMessageWithTimeout(bot, chatId, messageId, text, options) {
  return Promise.race([
    bot.editMessageText(text, {
      ...(options || {}),
      chat_id: chatId,
      message_id: messageId
    }),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Telegram editMessageText timed out after 30 seconds."));
      }, 30000);
    })
  ]).catch((error) => {
    if (isMessageNotModifiedError(error)) {
      return null;
    }
    throw error;
  });
}

// LEGACY THINKING DELIVERY: kept only as a reference for old behavior.
// Do not route hidden thinking through HTML expandable blockquotes here.
// The active single-bubble path is buildHiddenThinkingSingleBubblePlan(), which
// uses Telegram message entities so the folded thinking and final reply stay in
// one message. This comment exists because this area broke Telegram replies
// before; change it only after testing the hidden-thinking path end to end.
async function sendThinkingSummary(bot, chatId, summary, mode) {
  const cleaned = (summary || "").trim();
  if (!cleaned || mode === "off") {
    return;
  }

  const parts = splitMessage(cleaned, 2800);
  if (mode === "hidden") {
    for (const part of parts) {
      await bot.sendMessage(
        chatId,
        `<b>思路摘要</b>\n<blockquote expandable>${escapeHtml(part)}</blockquote>`,
        {
          parse_mode: "HTML"
        }
      );
    }
    return;
  }

  for (const part of parts) {
    await bot.sendMessage(chatId, `思路摘要：\n${part}`);
  }
}

const chatQueues = new Map();

// LEGACY THINKING DELIVERY: buildReplyDeliveryPlan() can still use the delivery
// helper below for non-hidden fallbacks, but hidden mode should normally be
// handled by buildHiddenThinkingSingleBubblePlan(). Avoid reusing this helper
// for the Telegram hidden-thinking UI unless Telegram clients are retested.
function buildThinkingBlock(summary, mode) {
  const cleaned = (summary || "").trim();
  if (!cleaned || mode === "off") {
    return null;
  }

  if (mode === "hidden") {
    return `<b>思考过程</b>\n<blockquote expandable>${escapeHtml(cleaned)}</blockquote>`;
  }

  return `<b>思考过程</b>\n<blockquote>${escapeHtml(cleaned)}</blockquote>`;
}

// LEGACY THINKING DELIVERY: retained for compatibility/reference only. The
// hidden-thinking UI relies on explicit Telegram entities, not raw HTML, because
// HTML expandable blockquotes previously hid the actual reply on some clients.
function buildThinkingBlockHtml(summary, mode) {
  const cleaned = String(summary || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned || mode === "off") {
    return null;
  }

  const refineHeadingMatch = cleaned.match(
    /\n\*\*Refining the (Output|Response)[^\n]*\*\*/i
  );
  const visibleThinking = refineHeadingMatch
    ? cleaned.slice(0, refineHeadingMatch.index).trim()
    : cleaned;

  if (!visibleThinking) {
    return null;
  }

  if (mode === "hidden") {
    return `<b>Thinking</b>\n<blockquote expandable>${escapeHtml(visibleThinking)}</blockquote>`;
  }

  return `<b>Thinking</b>\n<blockquote>${escapeHtml(visibleThinking)}</blockquote>`;
}

function buildThinkingBlockHtmlForDelivery(summary, mode) {
  const cleaned = String(summary || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned || mode === "off") {
    return null;
  }

  const refineHeadingMatch = cleaned.match(
    /\n\*\*Refining the (Output|Response)[^\n]*\*\*/i
  );
  const visibleThinking = refineHeadingMatch
    ? cleaned.slice(0, refineHeadingMatch.index).trim()
    : cleaned;

  if (!visibleThinking) {
    return null;
  }

  // Legacy fallback only: normal hidden delivery is intercepted earlier by
  // buildHiddenThinkingSingleBubblePlan(), which uses Telegram entities and
  // keeps thinking + reply in one bubble. Keep this spoiler fallback for callers
  // that bypass the normal send/finalize path, but do not replace the entity
  // path without testing Telegram hidden-thinking replies end to end.
  if (mode === "hidden") {
    return `<b>Thinking</b>\n<tg-spoiler>${escapeHtml(visibleThinking)}</tg-spoiler>`;
  }

  return `<b>Thinking</b>\n<blockquote>${escapeHtml(visibleThinking)}</blockquote>`;
}

function buildHiddenThinkingSingleBubblePlan(summary, replyText) {
  const cleaned = String(summary || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const reply = String(replyText || "").trim();
  if (!cleaned) {
    return null;
  }

  const refineHeadingMatch = cleaned.match(
    /\n\*\*Refining the (Output|Response)[^\n]*\*\*/i
  );
  const visibleThinking = refineHeadingMatch
    ? cleaned.slice(0, refineHeadingMatch.index).trim()
    : cleaned;

  if (!visibleThinking) {
    return null;
  }

  const firstMessageLimit = 3900;
  const prefix = "Thinking\n";
  const separator = "\n\n";
  const firstBudget = Math.max(
    300,
    firstMessageLimit - prefix.length - visibleThinking.length - separator.length
  );
  const replyParts = splitMessage(reply || "No response returned.", firstBudget);
  const firstReplyPart = replyParts.shift() || "No response returned.";
  const firstMessageText = `${prefix}${visibleThinking}${separator}${firstReplyPart}`;

  // Hidden thinking must stay in the same bubble as the final reply, but
  // parse_mode HTML has been unreliable here: some Telegram clients swallow the
  // text after <blockquote expandable> and only show the heading. Using
  // message entities makes the expandable quote boundary explicit, so the reply
  // can safely continue in the same message underneath the folded block.
  return {
    firstMessageText,
    firstMessageEntities: [
      {
        type: "bold",
        offset: 0,
        length: "Thinking".length
      },
      {
        type: "expandable_blockquote",
        offset: prefix.length,
        length: visibleThinking.length
      }
    ],
    extraReplyParts: replyParts
  };
}

function buildReplyDeliveryPlan(replyText, summary, mode) {
  const reply = String(replyText || "").trim();
  const firstMessageLimit = 3900;
  const separator = "\n\n";
  const thinkingBlock = buildThinkingBlockHtmlForDelivery(summary, mode);

  if (!thinkingBlock) {
    const replyParts = splitMessage(reply || "No response returned.");
    const firstReplyPart = replyParts.shift() || "No response returned.";
    return {
      firstMessageHtml: escapeHtml(firstReplyPart),
      extraReplyParts: replyParts
    };
  }

  const firstBudget = Math.max(300, firstMessageLimit - thinkingBlock.length - separator.length);
  const replyParts = splitMessage(reply || "No response returned.", firstBudget);
  const firstReplyPart = replyParts.shift() || "No response returned.";
  return {
    firstMessageHtml: `${thinkingBlock}${separator}${escapeHtml(firstReplyPart)}`,
    extraReplyParts: replyParts
  };
}

function buildStreamingPreviewHtml(replyPreviewText) {
  const cleaned = String(replyPreviewText || "").trim();
  if (!cleaned) {
    return "<i>Generating...</i>";
  }

  const maxPreviewChars = 3600;
  const clipped = cleaned.length > maxPreviewChars;
  const visible = clipped ? cleaned.slice(0, maxPreviewChars).trimEnd() : cleaned;
  return clipped
    ? `${escapeHtml(visible)}\n\n<i>Continuing...</i>`
    : escapeHtml(visible);
}

async function sendReplyWithThinking(bot, chatId, replyText, summary, mode, extraOptions) {
  if (mode === "hidden") {
    const hiddenThinkingPlan = buildHiddenThinkingSingleBubblePlan(summary, replyText);
    if (hiddenThinkingPlan) {
      await sendMessageWithTimeout(bot, chatId, hiddenThinkingPlan.firstMessageText, {
        ...(extraOptions || {}),
        entities: hiddenThinkingPlan.firstMessageEntities
      });
      for (const part of hiddenThinkingPlan.extraReplyParts) {
        await sendMessageWithTimeout(bot, chatId, part, extraOptions || {});
      }
      return;
    }
  }

  const plan = buildReplyDeliveryPlan(replyText, summary, mode);
  await sendMessageWithTimeout(bot, chatId, plan.firstMessageHtml, {
    ...(extraOptions || {}),
    parse_mode: "HTML"
  });

  for (const part of plan.extraReplyParts) {
    await sendMessageWithTimeout(bot, chatId, escapeHtml(part), {
      ...(extraOptions || {}),
      parse_mode: "HTML"
    });
  }
}

async function finalizeStreamedReplyWithThinking(
  bot,
  chatId,
  messageId,
  replyText,
  summary,
  mode,
  extraOptions
) {
  if (mode === "hidden") {
    const hiddenThinkingPlan = buildHiddenThinkingSingleBubblePlan(summary, replyText);
    if (hiddenThinkingPlan) {
      // The streaming placeholder becomes the final one-bubble reply: folded
      // thinking on top, normal assistant text underneath. This keeps hidden
      // mode visually close to Gemini while still avoiding the HTML blockquote
      // parsing bug that previously collapsed the reply body into the thought
      // block or left only the heading visible.
      await editMessageWithTimeout(
        bot,
        chatId,
        messageId,
        hiddenThinkingPlan.firstMessageText,
        {
          ...(extraOptions || {}),
          entities: hiddenThinkingPlan.firstMessageEntities
        }
      );
      for (const part of hiddenThinkingPlan.extraReplyParts) {
        await sendMessageWithTimeout(bot, chatId, part, extraOptions || {});
      }
      return;
    }
  }

  const plan = buildReplyDeliveryPlan(replyText, summary, mode);
  await editMessageWithTimeout(bot, chatId, messageId, plan.firstMessageHtml, {
    ...(extraOptions || {}),
    parse_mode: "HTML"
  });

  for (const part of plan.extraReplyParts) {
    await sendMessageWithTimeout(bot, chatId, escapeHtml(part), {
      ...(extraOptions || {}),
      parse_mode: "HTML"
    });
  }
}

function enqueueChat(chatId, task) {
  const previous = chatQueues.get(chatId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (chatQueues.get(chatId) === next) {
        chatQueues.delete(chatId);
      }
    });
  chatQueues.set(chatId, next);
  return next;
}

function triggerTelegramMemoryIngest(chatId) {
  const state = loadChatState(chatId);
  const completedTurns = Number.isInteger(state.completedTurnsSinceMemoryIngest)
    ? state.completedTurnsSinceMemoryIngest
    : 0;
  if (completedTurns < MEMORY_INGEST_TURN_THRESHOLD) {
    log("skipping memory ingest because turn threshold is not met", {
      chatId,
      completedTurns,
      requiredTurns: MEMORY_INGEST_TURN_THRESHOLD
    });
    return;
  }

  const lastAt = memoryIngestCooldowns.get(chatId) || 0;
  if (Date.now() - lastAt < 30000) {
    return;
  }
  memoryIngestCooldowns.set(chatId, Date.now());

  const child = spawn(
    process.execPath,
    [path.join(ROOT, "memory-ingest.cjs"), "--source", "telegram", "--chat-id", chatId],
    {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      detached: false,
      stdio: "ignore"
    }
  );

  child.on("error", (error) => {
    // If the child process never really starts, restore the turn counter so we
    // can retry on the next idle window instead of silently dropping turns.
    const failedState = loadChatState(chatId);
    failedState.completedTurnsSinceMemoryIngest = completedTurns;
    saveChatState(failedState);
    log("memory ingest spawn failed", {
      chatId,
      error: error.message
    });
  });

  // Reset only after the background ingest process has been launched. The
  // ingest script itself decides what summaries to write; this counter only
  // controls the bridge-side trigger policy.
  state.completedTurnsSinceMemoryIngest = 0;
  state.lastMemoryIngestAt = new Date().toISOString();
  saveChatState(state);
  log("triggered memory ingest", {
    chatId,
    completedTurns,
    requiredTurns: MEMORY_INGEST_TURN_THRESHOLD
  });
}

function scheduleTelegramMemoryIngest(chatId, completedTurns) {
  if (completedTurns < MEMORY_INGEST_TURN_THRESHOLD) {
    log("memory ingest not scheduled because threshold is not met", {
      chatId,
      completedTurns,
      requiredTurns: MEMORY_INGEST_TURN_THRESHOLD
    });
    return;
  }

  clearScheduledMemoryIngest(chatId);
  const timer = setTimeout(() => {
    memoryIngestTimers.delete(chatId);
    triggerTelegramMemoryIngest(chatId);
  }, MEMORY_INGEST_IDLE_MS);
  memoryIngestTimers.set(chatId, timer);
  log("scheduled memory ingest", {
    chatId,
    idleMs: MEMORY_INGEST_IDLE_MS,
    completedTurns,
    requiredTurns: MEMORY_INGEST_TURN_THRESHOLD
  });
}

async function handleTelegramMessage(bot, msg) {
  const chatId = String(msg.chat.id);
  const messageText = (msg.text || "").trim();
  const isPrivate = msg.chat.type === "private";

  if (!messageText || !isPrivate) {
    return;
  }

  if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(chatId)) {
    await bot.sendMessage(chatId, "This bot is currently restricted to another chat.");
    return;
  }

  const command = commandOf(messageText);
  const menuAction = menuActionOf(messageText);

  if (command === "/start") {
    const state = loadChatState(chatId);
    await sendMainMenu(bot, chatId, state);
    return;
  }

  if (command === "/menu" || (menuAction && menuAction.kind === "main-menu")) {
    const state = loadChatState(chatId);
    await sendMainMenu(bot, chatId, state);
    return;
  }

  if (command === "/help" || (menuAction && menuAction.kind === "help")) {
    const state = loadChatState(chatId);
    await bot.sendMessage(
      chatId,
      [
        "帮助",
        "",
        "直接发任何消息都可以正常聊天。",
        `当前模型：${describeModelSelection(state)}`,
        `思路摘要：${describeThinkingMode(state.thinkingMode || "hidden")}`,
        "",
        "主要命令：",
        "/menu  主菜单",
        "/model 切换模型",
        "/memory 记忆系统",
        "/thinking off|hidden|visible",
        "/status 当前状态",
        "/reset 清空这段对话",
        "",
        ...buildModelCatalogLines()
      ].join("\n"),
      buildMainMenuKeyboard()
    );
    return;
  }

  if (command === "/reset" || (menuAction && menuAction.kind === "reset")) {
    clearScheduledMemoryIngest(chatId);
    resetChatState(chatId);
    await bot.sendMessage(chatId, "这段对话上下文已经清空。", buildMainMenuKeyboard());
    return;
  }

  if (command === "/status" || (menuAction && menuAction.kind === "status")) {
    const state = loadChatState(chatId);
    const sharedMemory = readSharedMemoryStatus();
    await bot.sendMessage(
      chatId,
      [
        "当前状态",
        `模型：${describeModelSelection(state)}`,
        `会话：${state.sessionId || "还没有会话"}`,
        `思路摘要：${describeThinkingMode(state.thinkingMode || "hidden")}`,
        // [BUG-T1 FIX] 原来引用了未定义的 SHARED_MEMORY_URL，会导致 ReferenceError
        `共享记忆来源：${SHARED_MEMORY_PAGE_URL || "未配置"}`,
        `最近同步：${
          sharedMemory && sharedMemory.syncedAt
            ? formatTimeOrFallback(sharedMemory.syncedAt, "未知")
            : "还没有同步记录"
        }`
      ].join("\n"),
      buildMainMenuKeyboard()
    );
    return;
  }

  if (command === "/memory" || (menuAction && menuAction.kind === "memory-menu")) {
    await sendMemoryMenu(bot, chatId);
    return;
  }

  if (menuAction && menuAction.kind === "persona-memory") {
    await sendPersonaMemoryInfo(bot, chatId);
    return;
  }

  if (menuAction && menuAction.kind === "daily-memory") {
    await sendDailyMemoryInfo(bot, chatId);
    return;
  }

  if (menuAction && menuAction.kind === "hide-menu") {
    await bot.sendMessage(
      chatId,
      "菜单已经收起。你可以直接发消息继续聊天；需要时再输入 /menu 打开主菜单。",
      buildHiddenMenuKeyboard()
    );
    return;
  }

  if (
    command === "/model" ||
    (menuAction &&
      (menuAction.kind === "model-menu" || menuAction.kind === "model-selection"))
  ) {
    const state = loadChatState(chatId);
    if (menuAction && menuAction.kind === "model-menu") {
      await sendModelMenu(bot, chatId, state);
      return;
    }

    const selection =
      menuAction && menuAction.kind === "model-selection"
        ? parseModelSelection(`/model ${menuAction.value}`)
        : parseModelSelection(messageText);
    if (selection.kind === "status") {
      await sendModelMenu(bot, chatId, state);
      return;
    }

    await applyModelSelection(bot, chatId, state, selection);
    return;
  }

  if (command === "/thinking" || (menuAction && menuAction.kind === "thinking")) {
    const state = loadChatState(chatId);
    const nextMode = command === "/thinking" ? parseThinkingMode(messageText) : null;
    if (!nextMode) {
      await bot.sendMessage(
        chatId,
        [
          `当前思路摘要模式：${describeThinkingMode(
            state.thinkingMode || "hidden"
          )}`,
          "",
          "用法：",
          "/thinking off",
          "/thinking hidden",
          "/thinking visible"
        ].join("\n"),
        buildMainMenuKeyboard()
      );
      return;
    }

    state.thinkingMode = nextMode;
    saveChatState(state);
    await bot.sendMessage(
      chatId,
      `思路摘要模式已切换为 ${describeThinkingMode(nextMode)}。`,
      buildMainMenuKeyboard()
    );
    return;
  }

  // [BUG-T4 FIX] 排队提示统一中文
  if (chatQueues.has(chatId)) {
    await bot.sendMessage(chatId, "上一条消息还在处理中，这条已经排上队了。");
  }

  enqueueChat(chatId, async () => {
    const typingTimer = setInterval(() => {
      bot.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);
    let streamMessageId = null;
    let previewUpdateChain = Promise.resolve();
    let lastQueuedPreview = "";

    try {
      clearScheduledMemoryIngest(chatId);
      log("received telegram message", {
        chatId,
        textPreview: messageText.slice(0, 120)
      });
      await bot.sendChatAction(chatId, "typing");
      void refreshSharedMemory(false);

      const state = loadChatState(chatId);
      state.history = Array.isArray(state.history) ? state.history : [];
      state.thinkingMode = state.thinkingMode || "hidden";
      state.modelMode = state.modelMode || "quality";
      state.history.push({
        role: "user",
        content: messageText,
        at: new Date().toISOString()
      });
      const activeModel = resolveModelForState(state);
      const allowNativeThinking = state.thinkingMode !== "off";
      const prompt = state.sessionId
        ? buildTurnPrompt(messageText, { allowNativeThinking })
        : buildInitialPrompt(messageText, { allowNativeThinking });
      const streamMessage = await sendMessageWithTimeout(
        bot,
        chatId,
        buildStreamingPreviewHtml(""),
        {
          parse_mode: "HTML"
        }
      );
      streamMessageId = streamMessage && streamMessage.message_id ? streamMessage.message_id : null;

      const queuePreviewUpdate = (previewText) => {
        const normalizedPreview = String(previewText || "").trim();
        if (!streamMessageId || !normalizedPreview || normalizedPreview === lastQueuedPreview) {
          return;
        }
        lastQueuedPreview = normalizedPreview;
        previewUpdateChain = previewUpdateChain
          .catch(() => {})
          .then(() =>
            editMessageWithTimeout(
              bot,
              chatId,
              streamMessageId,
              buildStreamingPreviewHtml(normalizedPreview),
              {
                parse_mode: "HTML"
              }
            )
          );
      };

      const result = await callGeminiStream(
        prompt,
        state.sessionId,
        activeModel,
        queuePreviewUpdate
      );

      state.sessionId = result.sessionId || state.sessionId;
      state.lastUserMessage = messageText;
      state.lastAssistantMessage = result.text;
      state.history.push({
        role: "assistant",
        content: result.text,
        at: new Date().toISOString()
      });
      // Count completed dialogue turns here, after the assistant reply exists.
      // The memory trigger should reflect real back-and-forth conversation, not
      // raw user message count or every idle pause.
      state.completedTurnsSinceMemoryIngest = (
        Number.isInteger(state.completedTurnsSinceMemoryIngest)
          ? state.completedTurnsSinceMemoryIngest
          : 0
      ) + 1;
      if (state.history.length > 24) {
        state.history = state.history.slice(-24);
      }
      log("saving chat state", {
        chatId,
        sessionId: state.sessionId,
        historyCount: state.history.length,
        completedTurnsSinceMemoryIngest: state.completedTurnsSinceMemoryIngest
      });
      saveChatState(state);
      log("chat state saved", {
        chatId,
        updatedAt: state.updatedAt
      });

      const thinkingText =
        state.thinkingMode !== "off" && result.thinkingText
          ? result.thinkingText
          : null;
      await previewUpdateChain.catch(() => {});
      log("sending telegram reply", {
        chatId,
        textLength: result.text.length,
        model: activeModel,
        thinkingMode: state.thinkingMode,
        hasThinking: Boolean(thinkingText && thinkingText.trim())
      });
      if (streamMessageId) {
        await finalizeStreamedReplyWithThinking(
          bot,
          chatId,
          streamMessageId,
          result.text,
          thinkingText,
          state.thinkingMode
        );
      } else {
        await sendReplyWithThinking(
          bot,
          chatId,
          result.text,
          thinkingText,
          state.thinkingMode
        );
      }
      log("sent telegram reply", {
        chatId,
        textPreview: result.text.slice(0, 120)
      });
      scheduleTelegramMemoryIngest(
        chatId,
        state.completedTurnsSinceMemoryIngest
      );
    } catch (error) {
      log("message handling failed", {
        chatId,
        error: error.message
      });
      if (streamMessageId) {
        // [BUG-T4 FIX] 错误消息统一中文
        await editMessageWithTimeout(
          bot,
          chatId,
          streamMessageId,
          escapeHtml(`桥接出错了：\n${error.message.slice(0, 3000)}`),
          {
            parse_mode: "HTML"
          }
        ).catch(() => {});
      } else {
        await bot.sendMessage(
          chatId,
          `桥接出错了：\n${error.message.slice(0, 3000)}`
        );
      }
    } finally {
      clearInterval(typingTimer);
    }
  });
}

process.on("uncaughtException", (error) => {
  log("uncaught exception", error && error.stack ? error.stack : String(error));
});

process.on("unhandledRejection", (reason) => {
  log("unhandled rejection", reason && reason.stack ? reason.stack : String(reason));
});

process.on("exit", () => {
  releaseBridgeLock();
});

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => {
    releaseBridgeLock();
    process.exit(0);
  });
}

async function runHealthcheck() {
  ensureBridgeHome();
  await refreshSharedMemory(true);
  const result = await callGemini("Reply with exactly OK.", null, DEFAULT_QUALITY_MODEL);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        model: DEFAULT_QUALITY_MODEL,
        response: result.text
      },
      null,
      2
    )}\n`
  );
}

async function startBridge() {
  const TelegramBot = requireFromTelegramPackage("node-telegram-bot-api");
  acquireBridgeLock();
  ensureBridgeHome();
  await refreshSharedMemory(true);

  const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: true,
    filepath: false
  });

  await bot.setMyCommands([
    { command: "menu", description: "主菜单" },
    { command: "model", description: "切换模型" },
    { command: "memory", description: "记忆系统" },
    { command: "thinking", description: "思路摘要" },
    { command: "status", description: "当前状态" },
    { command: "reset", description: "重置对话" },
    { command: "help", description: "帮助" }
  ]);

  bot.on("message", (msg) => {
    handleTelegramMessage(bot, msg).catch((error) => {
      log("unhandled message error", error.message);
    });
  });

  bot.on("polling_error", (error) => {
    const message = error && error.message ? error.message : String(error);
    log("polling error", message);
  });

  const botInfo = await bot.getMe();
  log("bridge started", {
    bot: botInfo.username,
    defaultQualityModel: DEFAULT_QUALITY_MODEL,
    defaultFastModel: DEFAULT_FAST_MODEL,
    allowedChatIds: ALLOWED_CHAT_IDS
  });
}

async function main() {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  if (process.argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (process.argv.includes("--healthcheck")) {
    await runHealthcheck();
    return;
  }

  await startBridge();
}

main().catch((error) => {
  releaseBridgeLock();
  log("fatal", error.message);
  process.exit(1);
});
