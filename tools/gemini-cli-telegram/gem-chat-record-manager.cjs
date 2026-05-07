const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

const HOST = process.env.GEM_CHAT_RECORD_MANAGER_HOST || "127.0.0.1";
const PORT = Math.max(
  1,
  Number.parseInt(process.env.GEM_CHAT_RECORD_MANAGER_PORT || "4144", 10) || 4144
);
const ROOT = __dirname;
const CHAT_STATE_DIR =
  process.env.GEM_CHAT_RECORD_STATE_DIR || path.join(ROOT, "bridge-state", "chats");
const ARCHIVE_DIR =
  process.env.GEM_CHAT_RECORD_ARCHIVE_DIR ||
  path.join(ROOT, "bridge-state", "chat-archives");
const PAGE_PATH = path.join(ROOT, "gem-chat-record-manager.html");
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

function log(...args) {
  process.stderr.write(`[gem-chat-record-manager] ${args.join(" ")}\n`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "text/html; charset=utf-8"
  });
  res.end(html);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function ensureChatStateDir() {
  fs.mkdirSync(CHAT_STATE_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function assertSafeChatId(chatId) {
  if (!/^[0-9A-Za-z_-]+$/.test(chatId || "")) {
    throw new Error("Invalid chat id.");
  }
}

function getChatPath(chatId) {
  assertSafeChatId(chatId);
  return path.join(CHAT_STATE_DIR, `${chatId}.json`);
}

function getArchiveChatDir(chatId) {
  assertSafeChatId(chatId);
  return path.join(ARCHIVE_DIR, chatId);
}

function getArchivePath(chatId, archiveId) {
  assertSafeChatId(chatId);
  if (!/^[0-9A-Za-z_-]+$/.test(archiveId || "")) {
    throw new Error("Invalid archive id.");
  }
  return path.join(getArchiveChatDir(chatId), `${archiveId}.json`);
}

function readJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(filePath, text, { encoding: "utf8" });
}

function backupChatFile(chatId, reason) {
  const filePath = getChatPath(chatId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const backupPath = `${filePath}.${reason}-backup-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function normalizeChatState(chatId, raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    chatId: String(state.chatId || chatId),
    history: Array.isArray(state.history) ? state.history : [],
    archivedAt: state.archivedAt || "",
    archiveId: state.archiveId || "",
    title: state.title || "",
    sessionId: state.sessionId || null,
    lastUserMessage: state.lastUserMessage || "",
    lastAssistantMessage: state.lastAssistantMessage || "",
    thinkingMode: state.thinkingMode || "hidden",
    modelMode: state.modelMode || "quality",
    customModel: state.customModel || null,
    completedTurnsSinceMemoryIngest: Number.isInteger(
      state.completedTurnsSinceMemoryIngest
    )
      ? state.completedTurnsSinceMemoryIngest
      : 0,
    lastMemoryIngestAt: state.lastMemoryIngestAt || "",
    updatedAt: state.updatedAt || new Date().toISOString(),
    importedFrom: state.importedFrom || "",
    importedSessionId: state.importedSessionId || ""
  };
}

function loadChatState(chatId) {
  return normalizeChatState(chatId, readJsonFile(getChatPath(chatId), null));
}

function loadArchiveState(chatId, archiveId) {
  return normalizeChatState(
    chatId,
    readJsonFile(getArchivePath(chatId, archiveId), null)
  );
}

function messageId(chatId, message, index, bucket) {
  const hash = crypto.createHash("sha256");
  hash.update(String(chatId));
  hash.update("\0");
  hash.update(String(bucket));
  hash.update("\0");
  hash.update(String(index));
  hash.update("\0");
  hash.update(String(message && message.role ? message.role : ""));
  hash.update("\0");
  hash.update(String(message && message.at ? message.at : ""));
  hash.update("\0");
  hash.update(String(message && message.content ? message.content : ""));
  return hash.digest("hex").slice(0, 24);
}

function decorateMessages(chatId, messages, bucket) {
  return messages.map((message, index) => ({
    id: messageId(chatId, message, index, bucket),
    index,
    bucket,
    role: message.role || "unknown",
    content: message.content || "",
    at: message.at || "",
    source: message.source || "",
    archivedAt: message.archivedAt || "",
    length: String(message.content || "").length
  }));
}

function parseTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function sourceGroupForState(state) {
  const importedFrom = String((state && state.importedFrom) || "").replace(/\\/g, "/");
  if (importedFrom.includes("/tmp/telegram-bridge/chats/")) {
    return "telegram";
  }
  if (importedFrom.includes("/tmp/2026-04-21-gemini-cli-telegram/chats/")) {
    return "gem-cli";
  }
  return importedFrom ? "imported" : "manual";
}

function sourceLabelForGroup(sourceGroup) {
  if (sourceGroup === "telegram") return "Telegram";
  if (sourceGroup === "gem-cli") return "Gem CLI";
  if (sourceGroup === "manual") return "手动归档";
  return "导入记录";
}

function uniqueDecoratedMessages(messages) {
  const byKey = new Map();
  for (const message of messages) {
    const key = `${message.role}\0${message.at}\0${message.content}`;
    if (!byKey.has(key) || message.bucket === "active") {
      byKey.set(key, message);
    }
  }
  return Array.from(byKey.values());
}

function recomputeLastMessages(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  const lastUser = [...history].reverse().find((item) => item.role === "user");
  const lastAssistant = [...history]
    .reverse()
    .find((item) => item.role === "assistant");
  state.lastUserMessage = lastUser ? lastUser.content || "" : "";
  state.lastAssistantMessage = lastAssistant ? lastAssistant.content || "" : "";
}

function saveEditedActiveChat(chatId, state, reason) {
  const backupPath = backupChatFile(chatId, reason);

  // Any change to active context must start a fresh Gemini CLI session. If the
  // old session is resumed, deleted or archived messages may still survive in
  // Gemini CLI's private conversation cache.
  state.sessionId = null;
  state.updatedAt = new Date().toISOString();
  recomputeLastMessages(state);
  writeJsonFile(getChatPath(chatId), state);

  return backupPath;
}

function backupArchiveFile(chatId, archiveId, reason) {
  const filePath = getArchivePath(chatId, archiveId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const backupPath = `${filePath}.${reason}-backup-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function saveEditedArchive(chatId, archiveId, state, reason) {
  const backupPath = backupArchiveFile(chatId, archiveId, reason);
  state.updatedAt = new Date().toISOString();
  recomputeLastMessages(state);
  writeJsonFile(getArchivePath(chatId, archiveId), state);
  return backupPath;
}

function listChatFiles() {
  ensureChatStateDir();
  return fs
    .readdirSync(CHAT_STATE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\w[\w-]*\.json$/.test(entry.name))
    .map((entry) => path.join(CHAT_STATE_DIR, entry.name));
}

function summarizeState(filePath, kind, archiveId = "") {
  const chatId = path.basename(filePath, ".json");
  const stat = fs.statSync(filePath);
  const state =
    kind === "archive" ? loadArchiveState(path.basename(path.dirname(filePath)), chatId) : loadChatState(chatId);
  const sourceGroup = kind === "archive" ? sourceGroupForState(state) : "telegram";
  const history = state.history || [];
  const latest = [...history]
    .filter((item) => item && item.at)
    .sort((a, b) => parseTime(b.at) - parseTime(a.at))[0];
  const realChatId = state.chatId || (kind === "archive" ? path.basename(path.dirname(filePath)) : chatId);
  const realArchiveId = kind === "archive" ? chatId : archiveId;
  return {
    windowId: kind === "archive" ? `archive:${realChatId}:${realArchiveId}` : `active:${realChatId}`,
    kind,
    chatId: realChatId,
    archiveId: realArchiveId,
    title:
      state.title ||
      (kind === "archive"
        ? `Archived ${realChatId} ${formatArchiveTitle(realArchiveId)}`
        : `Gem chat ${realChatId}`),
    activeCount: history.length,
    archivedCount: kind === "archive" ? history.length : 0,
    archivedAt: state.archivedAt || "",
    updatedAt: state.updatedAt || stat.mtime.toISOString(),
    latestAt: latest ? latest.at : "",
    latestPreview: latest ? String(latest.content || "").slice(0, 120) : "",
    fileName: path.basename(filePath),
    sourceGroup,
    sourceLabel: sourceLabelForGroup(sourceGroup)
  };
}

function formatArchiveTitle(archiveId) {
  const match = String(archiveId || "").match(/^archive-(\d{8})-(\d{6})$/);
  if (!match) return archiveId;
  const [, day, time] = match;
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

function listArchiveFiles() {
  ensureChatStateDir();
  const files = [];
  for (const entry of fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const chatDir = path.join(ARCHIVE_DIR, entry.name);
    for (const file of fs.readdirSync(chatDir, { withFileTypes: true })) {
      if (file.isFile() && /^archive-[0-9]{8}-[0-9]{6}\.json$/.test(file.name)) {
        files.push(path.join(chatDir, file.name));
      }
    }
  }
  return files;
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function requireIds(payload) {
  const ids = Array.isArray(payload && payload.ids) ? payload.ids : [];
  const clean = ids.filter((id) => typeof id === "string" && id.length > 0);
  if (clean.length === 0) {
    throw new Error("No message ids were provided.");
  }
  return new Set(clean);
}

function mutateSelectedMessages(state, ids, bucket = "active") {
  const history = Array.isArray(state.history) ? state.history : [];
  const selected = [];

  const nextHistory = [];
  history.forEach((message, index) => {
    const id = messageId(state.chatId, message, index, bucket);
    if (ids.has(id)) {
      selected.push({ message, bucket });
      return;
    }
    nextHistory.push(message);
  });

  state.history = nextHistory;
  return selected.length;
}

async function handleChats(req, res) {
  const activeChatIds = new Set(
    listChatFiles().map((filePath) => path.basename(filePath, ".json"))
  );
  for (const filePath of listArchiveFiles()) {
    const state = loadArchiveState(path.basename(path.dirname(filePath)), path.basename(filePath, ".json"));
    if (sourceGroupForState(state) === "telegram") {
      activeChatIds.add(String(state.chatId || path.basename(path.dirname(filePath))));
    }
  }

  const chats = [
    ...Array.from(activeChatIds).map((chatId) => summarizeTelegramWindow(chatId)),
    ...listArchiveFiles()
      .map((filePath) => summarizeState(filePath, "archive"))
      .filter((chat) => chat.sourceGroup !== "telegram")
  ].sort((a, b) => {
    return parseTime(b.latestAt || b.updatedAt) - parseTime(a.latestAt || a.updatedAt);
  });
  sendJson(res, 200, { chats });
}

function archiveIdFromPath(filePath) {
  return path.basename(filePath, ".json");
}

function archiveChatIdFromPath(filePath) {
  return path.basename(path.dirname(filePath));
}

function listTelegramArchiveFiles(chatId) {
  return listArchiveFiles().filter((filePath) => {
    const archiveChatId = archiveChatIdFromPath(filePath);
    if (archiveChatId !== String(chatId)) return false;
    const state = loadArchiveState(archiveChatId, archiveIdFromPath(filePath));
    return sourceGroupForState(state) === "telegram";
  });
}

function loadTelegramWindow(chatId) {
  const activeState = loadChatState(chatId);
  const activeMessages = decorateMessages(chatId, activeState.history, "active");
  const archiveStates = listTelegramArchiveFiles(chatId).map((filePath) => {
    const archiveId = archiveIdFromPath(filePath);
    const archiveState = loadArchiveState(chatId, archiveId);
    return { archiveId, archiveState };
  });
  const archiveMessages = archiveStates.flatMap(({ archiveId, archiveState }) =>
    decorateMessages(chatId, archiveState.history, `archive:${archiveId}`).map((message) => ({
      ...message,
      source: message.source || "telegram-session-import"
    }))
  );
  const messages = uniqueDecoratedMessages([...activeMessages, ...archiveMessages]).sort(
    (a, b) => parseTime(a.at) - parseTime(b.at)
  );
  return { activeState, archiveStates, messages };
}

function summarizeTelegramWindow(chatId) {
  const { activeState, messages } = loadTelegramWindow(chatId);
  const latest = [...messages].sort((a, b) => parseTime(b.at) - parseTime(a.at))[0];
  return {
    windowId: `telegram:${chatId}`,
    kind: "telegram",
    chatId: String(chatId),
    archiveId: "",
    title: `Telegram 当前窗口 ${chatId}`,
    activeCount: messages.length,
    archivedCount: 0,
    archivedAt: "",
    updatedAt: activeState.updatedAt || (latest && latest.at) || new Date().toISOString(),
    latestAt: latest ? latest.at : "",
    latestPreview: latest ? String(latest.content || "").slice(0, 120) : "",
    fileName: `${chatId}.json`,
    sourceGroup: "telegram"
  };
}

async function handleChat(req, res, chatId) {
  const state = loadChatState(chatId);
  const messages = decorateMessages(chatId, state.history, "active").sort(
    (a, b) => parseTime(a.at) - parseTime(b.at)
  );
  sendJson(res, 200, {
    chat: summarizeState(getChatPath(chatId), "active"),
    state: {
      chatId: state.chatId,
      sessionId: state.sessionId,
      updatedAt: state.updatedAt,
      thinkingMode: state.thinkingMode,
      modelMode: state.modelMode,
      customModel: state.customModel
    },
    messages
  });
}

async function handleArchive(req, res, chatId, archiveId) {
  const state = loadArchiveState(chatId, archiveId);
  const messages = decorateMessages(chatId, state.history, "active").sort(
    (a, b) => parseTime(a.at) - parseTime(b.at)
  );
  sendJson(res, 200, {
    chat: summarizeState(getArchivePath(chatId, archiveId), "archive"),
    state: {
      chatId: state.chatId,
      archiveId: state.archiveId,
      archivedAt: state.archivedAt,
      updatedAt: state.updatedAt,
      thinkingMode: state.thinkingMode,
      modelMode: state.modelMode,
      customModel: state.customModel
    },
    messages
  });
}

async function handleTelegramWindow(req, res, chatId) {
  const { activeState, messages } = loadTelegramWindow(chatId);
  sendJson(res, 200, {
    chat: summarizeTelegramWindow(chatId),
    state: {
      chatId: activeState.chatId,
      sessionId: activeState.sessionId,
      updatedAt: activeState.updatedAt,
      thinkingMode: activeState.thinkingMode,
      modelMode: activeState.modelMode,
      customModel: activeState.customModel
    },
    messages
  });
}

async function handleDeleteMessages(req, res, chatId, archiveId = "") {
  const payload = await readBody(req);
  const ids = requireIds(payload);
  const state = archiveId ? loadArchiveState(chatId, archiveId) : loadChatState(chatId);
  const changedCount = mutateSelectedMessages(state, ids);
  if (changedCount === 0) {
    sendJson(res, 409, {
      error: "No matching messages were changed. Refresh the page and try again."
    });
    return;
  }
  const backupPath = archiveId
    ? saveEditedArchive(chatId, archiveId, state, "delete-messages")
    : saveEditedActiveChat(chatId, state, "delete-messages");
  sendJson(res, 200, {
    ok: true,
    action: "delete-messages",
    changedCount,
    backupPath,
    sessionIdReset: !archiveId
  });
}

async function handleDeleteTelegramMessages(req, res, chatId) {
  const payload = await readBody(req);
  const ids = requireIds(payload);
  const activeState = loadChatState(chatId);
  const activeChangedCount = mutateSelectedMessages(activeState, ids, "active");
  const backups = [];
  let changedCount = 0;
  let sessionIdReset = false;

  if (activeChangedCount > 0) {
    backups.push(saveEditedActiveChat(chatId, activeState, "delete-telegram-messages"));
    changedCount += activeChangedCount;
    sessionIdReset = true;
  }

  for (const filePath of listTelegramArchiveFiles(chatId)) {
    const archiveId = archiveIdFromPath(filePath);
    const archiveState = loadArchiveState(chatId, archiveId);
    const archiveChangedCount = mutateSelectedMessages(
      archiveState,
      ids,
      `archive:${archiveId}`
    );
    if (archiveChangedCount > 0) {
      backups.push(saveEditedArchive(chatId, archiveId, archiveState, "delete-messages"));
      changedCount += archiveChangedCount;
    }
  }

  if (changedCount === 0) {
    sendJson(res, 409, {
      error: "No matching messages were changed. Refresh the page and try again."
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    action: "delete-telegram-messages",
    changedCount,
    backupPath: backups.filter(Boolean).join("; "),
    sessionIdReset
  });
}

async function handleExport(req, res, chatId) {
  const state = loadChatState(chatId);
  sendJson(res, 200, {
    exportedAt: new Date().toISOString(),
    note: "This is a Gem bridge context export, not a Telegram official history export.",
    chat: state
  });
}

async function handleExportArchive(req, res, chatId, archiveId) {
  const state = loadArchiveState(chatId, archiveId);
  sendJson(res, 200, {
    exportedAt: new Date().toISOString(),
    note: "This is an archived Gem bridge chat window export.",
    chat: state
  });
}

async function handleExportTelegram(req, res, chatId) {
  const { messages } = loadTelegramWindow(chatId);
  sendJson(res, 200, {
    exportedAt: new Date().toISOString(),
    note: "This is a merged Telegram bridge display export. It combines active context and old Telegram bridge session archives.",
    chat: summarizeTelegramWindow(chatId),
    messages
  });
}

function makeArchiveId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  return `archive-${stamp}`;
}

async function handleArchiveActiveWindow(req, res, chatId) {
  const state = loadChatState(chatId);
  if (!Array.isArray(state.history) || state.history.length === 0) {
    sendJson(res, 409, { error: "The active window has no messages to archive." });
    return;
  }

  const activeBackupPath = backupChatFile(chatId, "archive-window");
  const archiveId = makeArchiveId();
  fs.mkdirSync(getArchiveChatDir(chatId), { recursive: true });

  const archivedState = {
    ...state,
    archiveId,
    archivedAt: new Date().toISOString(),
    title: state.title || `Archived ${chatId} ${formatArchiveTitle(archiveId)}`,
    sessionId: null,
    updatedAt: new Date().toISOString()
  };
  writeJsonFile(getArchivePath(chatId, archiveId), archivedState);

  const resetState = normalizeChatState(chatId, {
    chatId,
    history: [],
    sessionId: null,
    thinkingMode: state.thinkingMode,
    modelMode: state.modelMode,
    customModel: state.customModel,
    completedTurnsSinceMemoryIngest: 0,
    lastMemoryIngestAt: "",
    updatedAt: new Date().toISOString()
  });
  writeJsonFile(getChatPath(chatId), resetState);

  sendJson(res, 200, {
    ok: true,
    action: "archive-window",
    archiveId,
    archivedPath: getArchivePath(chatId, archiveId),
    activeBackupPath,
    sessionIdReset: true
  });
}

async function handleDeleteArchiveWindow(req, res, chatId, archiveId) {
  const archivePath = getArchivePath(chatId, archiveId);
  if (!fs.existsSync(archivePath)) {
    sendError(res, 404, "Archive not found.");
    return;
  }
  const backupPath = backupArchiveFile(chatId, archiveId, "delete-window");
  fs.unlinkSync(archivePath);
  sendJson(res, 200, {
    ok: true,
    action: "delete-window",
    backupPath
  });
}

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const parts = url.pathname.split("/").filter(Boolean);

  Promise.resolve()
    .then(async () => {
      if (req.method === "GET" && url.pathname === "/") {
        sendHtml(res, fs.readFileSync(PAGE_PATH, "utf8"));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/chats") {
        await handleChats(req, res);
        return;
      }
      if (parts[0] === "api" && parts[1] === "telegram" && parts[2]) {
        const chatId = parts[2];
        if (req.method === "GET" && parts.length === 3) {
          await handleTelegramWindow(req, res, chatId);
          return;
        }
        if (req.method === "GET" && parts[3] === "export") {
          await handleExportTelegram(req, res, chatId);
          return;
        }
        if (req.method === "POST" && parts[3] === "delete-messages") {
          await handleDeleteTelegramMessages(req, res, chatId);
          return;
        }
      }
      if (parts[0] === "api" && parts[1] === "chats" && parts[2]) {
        const chatId = parts[2];
        if (req.method === "GET" && parts.length === 3) {
          await handleChat(req, res, chatId);
          return;
        }
        if (req.method === "GET" && parts[3] === "export") {
          await handleExport(req, res, chatId);
          return;
        }
        if (req.method === "POST" && parts[3] === "delete-messages") {
          await handleDeleteMessages(req, res, chatId);
          return;
        }
        if (req.method === "POST" && parts[3] === "archive-window") {
          await handleArchiveActiveWindow(req, res, chatId);
          return;
        }
      }
      if (parts[0] === "api" && parts[1] === "archives" && parts[2] && parts[3]) {
        const chatId = parts[2];
        const archiveId = parts[3];
        if (req.method === "GET" && parts.length === 4) {
          await handleArchive(req, res, chatId, archiveId);
          return;
        }
        if (req.method === "GET" && parts[4] === "export") {
          await handleExportArchive(req, res, chatId, archiveId);
          return;
        }
        if (req.method === "POST" && parts[4] === "delete-messages") {
          await handleDeleteMessages(req, res, chatId, archiveId);
          return;
        }
        if (req.method === "POST" && parts[4] === "delete-window") {
          await handleDeleteArchiveWindow(req, res, chatId, archiveId);
          return;
        }
      }
      sendError(res, 404, "Not found.");
    })
    .catch((error) => {
      log(error && error.stack ? error.stack : String(error));
      sendError(res, 500, error && error.message ? error.message : "Server error.");
    });
}

ensureChatStateDir();
http.createServer(route).listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`);
  log(`chat state directory: ${CHAT_STATE_DIR}`);
});
