const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { ROOT, getSharedMemoryConfig, getMemoryEntriesUrl, httpRequestJson } = require("./cloud-memory-client.cjs");
const {
  createGenerationSignature,
  createRecord,
  deleteExpiredTrash,
  ensureMemoryStructure,
  hasLargeSummarySignature,
  listRecords,
  markLargeSummarySignature,
  migrateLegacySmallSummaryStore,
  moveRecordToTrash
} = require("./independent-memory-store.cjs");

const REAL_HOME = os.homedir();
const APPDATA_DIR =
  process.env.APPDATA || path.join(REAL_HOME, "AppData", "Roaming");
const GEMINI_BUNDLE_PATH = path.join(
  APPDATA_DIR,
  "npm",
  "node_modules",
  "@google",
  "gemini-cli",
  "bundle",
  "gemini.js"
);
const INGEST_STATE_PATH = path.join(
  ROOT,
  "bridge-state",
  "memory-ingest-state.json"
);
const TELEGRAM_CHAT_DIR = path.join(ROOT, "bridge-state", "chats");
const INGEST_MODEL =
  process.env.BRIDGE_GEMINI_MODEL || "gemini-3.1-pro-preview";

// Small summaries are the first layer the user asked us to implement.
// We preserve the old score knobs for future reuse, but the gate stays off
// until the larger memory architecture is stable.
const SMALL_SUMMARY_BATCH_SIZE = 15;
const LARGE_SUMMARY_SOURCE_COUNT = 15;
const LARGE_SUMMARY_TRIGGER_COUNT = 16;
const MIN_MEMORY_CONFIDENCE = Math.max(
  0,
  Math.min(
    1,
    Number.parseFloat(process.env.MEMORY_MIN_CONFIDENCE || "0.8") || 0.8
  )
);
const MIN_MEMORY_IMPORTANCE = Math.max(
  0,
  Math.min(
    1,
    Number.parseFloat(process.env.MEMORY_MIN_IMPORTANCE || "0.85") || 0.85
  )
);
const ENABLE_SCORE_GATING =
  String(process.env.MEMORY_ENABLE_SCORE_GATING || "false").toLowerCase() ===
  "true";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createEmptyIngestState() {
  return {
    version: 3,
    telegram: {}
  };
}

function normalizeCursor(cursor) {
  if (typeof cursor === "string") {
    return {
      lastUpdated: cursor,
      processedMessageCount: 0
    };
  }

  if (!cursor || typeof cursor !== "object") {
    return {
      lastUpdated: "",
      processedMessageCount: 0
    };
  }

  return {
    lastUpdated: String(cursor.lastUpdated || ""),
    processedMessageCount: Math.max(
      0,
      Number.parseInt(cursor.processedMessageCount, 10) || 0
    )
  };
}

function normalizeIngestState(state) {
  const raw = state && typeof state === "object" ? state : createEmptyIngestState();
  const normalized = createEmptyIngestState();

  for (const channel of ["telegram"]) {
    const channelState =
      raw[channel] && typeof raw[channel] === "object" ? raw[channel] : {};
    for (const [sourceRef, cursor] of Object.entries(channelState)) {
      normalized[channel][sourceRef] = normalizeCursor(cursor);
    }
  }

  return normalized;
}

function loadIngestState() {
  return normalizeIngestState(
    readJson(INGEST_STATE_PATH, createEmptyIngestState())
  );
}

function saveIngestState(state) {
  writeJson(INGEST_STATE_PATH, normalizeIngestState(state));
}

function normalizeTelegramMessages(chatJson) {
  const history = Array.isArray(chatJson && chatJson.history)
    ? chatJson.history
    : [];

  return history
    .map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: String(item.content || "").trim(),
      at: String(item.at || chatJson.updatedAt || "")
    }))
    .filter((message) => message.content);
}

function buildSourceSnapshot(sourceChannel, sourceRef, updatedAt, messages, cursor) {
  const processedMessageCount = Math.min(
    Math.max(0, cursor.processedMessageCount),
    messages.length
  );

  return {
    sourceChannel,
    sourceRef,
    updatedAt,
    messages,
    processedMessageCount
  };
}

function collectTelegramSources(state, chatId) {
  if (!fs.existsSync(TELEGRAM_CHAT_DIR)) return [];

  const targets = chatId
    ? [path.join(TELEGRAM_CHAT_DIR, `${chatId}.json`)]
    : fs
        .readdirSync(TELEGRAM_CHAT_DIR)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(TELEGRAM_CHAT_DIR, name));

  const sources = [];

  for (const item of targets
    .map((filePath) => ({
      filePath,
      json: readJson(filePath, null)
    }))
    .filter((item) => item.json && item.json.updatedAt)) {
    const cursor = normalizeCursor(state.telegram[item.filePath]);
    const messages = normalizeTelegramMessages(item.json);
    sources.push(
      buildSourceSnapshot(
        "telegram",
        item.filePath,
        item.json.updatedAt,
        messages,
        cursor
      )
    );
  }

  return sources
    .filter(
      (item) =>
        item.messages.length > item.processedMessageCount ||
        (item.updatedAt &&
          item.updatedAt !== normalizeCursor(state.telegram[item.sourceRef]).lastUpdated)
    )
    .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt))
    .slice(-2);
}

function createPendingBatches(source) {
  const batches = [];
  let startIndex = source.processedMessageCount;

  while (source.messages.length - startIndex >= SMALL_SUMMARY_BATCH_SIZE) {
    const endExclusive = startIndex + SMALL_SUMMARY_BATCH_SIZE;
    const messages = source.messages.slice(startIndex, endExclusive);
    batches.push({
      sourceChannel: source.sourceChannel,
      sourceRef: source.sourceRef,
      updatedAt: source.updatedAt,
      startIndex,
      endIndex: endExclusive - 1,
      messages,
      firstMessageAt: messages[0] ? messages[0].at : "",
      lastMessageAt: messages[messages.length - 1]
        ? messages[messages.length - 1].at
        : ""
    });
    startIndex = endExclusive;
  }

  return batches;
}

function buildBatchTranscript(batch) {
  return batch.messages
    .map((message, index) => {
      const speaker = message.role === "user" ? "User" : "Assistant";
      return `${index + 1}. ${speaker}: ${message.content}`;
    })
    .join("\n\n");
}

function normalizeResponseText(responseText) {
  const trimmed = String(responseText || "").trim();
  if (!trimmed) return "";

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }

  return trimmed;
}

function normalizeScore(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value >= 0 && value <= 1) {
    return value;
  }
  if (value >= 0 && value <= 10) {
    return value / 10;
  }
  return null;
}

function passesScoreGate(candidate) {
  if (!ENABLE_SCORE_GATING) {
    return true;
  }

  const confidence = normalizeScore(candidate.confidence);
  const importance = normalizeScore(candidate.importance);

  if (confidence === null || confidence < MIN_MEMORY_CONFIDENCE) {
    return false;
  }

  if (importance === null || importance < MIN_MEMORY_IMPORTANCE) {
    return false;
  }

  return true;
}

function callGeminiJson(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        GEMINI_BUNDLE_PATH,
        "-m",
        INGEST_MODEL,
        "--approval-mode",
        "plan",
        "--prompt",
        "",
        "-o",
        "json"
      ],
      {
        cwd: ROOT,
        // [BUG-T6 FIX] 使用和主桥接一致的 bridge-home 隔离 Gemini CLI 配置，
        // 避免和主桥接或用户本地 CLI 的 OAuth 凭据 / trustedFolders 冲突。
        env: {
          ...process.env,
          USERPROFILE: path.join(ROOT, "bridge-home"),
          HOME: path.join(ROOT, "bridge-home"),
          GEMINI_CLI_TRUSTED_FOLDERS_PATH: path.join(
            ROOT, "bridge-home", ".gemini", "trustedFolders.json"
          )
        },
        windowsHide: true
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Memory extraction timed out."));
    }, 120000);

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
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      let payload = null;
      try {
        payload = stdout.trim() ? JSON.parse(stdout.trim()) : null;
      } catch (error) {
        reject(new Error(`Failed to parse Gemini wrapper JSON: ${error.message}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || `Gemini exited with ${code}`));
        return;
      }

      resolve(
        normalizeResponseText(payload && payload.response ? payload.response : "")
      );
    });
  });
}

function buildSmallSummaryPrompt(batch) {
  return [
    "Create one concise checkpoint summary for this 15-message conversation slice.",
    "Return JSON only with the shape:",
    '{"summary":"...","confidence":0.0,"importance":0.0}',
    "Rules:",
    "- MUST write in Simplified Chinese (简体中文).",
    "- Write 2 to 4 sentences in plain language.",
    "- Focus on what changed, what was decided, what was learned, or what emotional/contextual shift happened in this slice.",
    "- This is a small checkpoint summary, not a long-term memory entry.",
    "- Do not turn the slice into a list of every detail.",
    "- Do not invent facts that are not clearly present.",
    "",
    `Source channel: ${batch.sourceChannel}`,
    `Source ref: ${batch.sourceRef}`,
    `Slice message range: ${batch.startIndex + 1}-${batch.endIndex + 1}`,
    "",
    "Conversation slice:",
    buildBatchTranscript(batch)
  ].join("\n");
}

async function summarizeSmallBatch(batch) {
  const responseText = await callGeminiJson(buildSmallSummaryPrompt(batch));
  let parsed = { summary: "" };

  if (responseText) {
    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      throw new Error(
        `Failed to parse small-summary JSON for ${batch.sourceRef}: ${error.message}`
      );
    }
  }

  if (
    !parsed ||
    typeof parsed.summary !== "string" ||
    !parsed.summary.trim() ||
    !passesScoreGate(parsed)
  ) {
    return null;
  }

  return {
    title: `${batch.sourceChannel} small summary`,
    content: parsed.summary.trim(),
    confidence: normalizeScore(parsed.confidence),
    importance: normalizeScore(parsed.importance)
  };
}

function buildLargeSummaryPrompt(records) {
  const lines = [
    "Create one higher-level large summary from these earlier small summaries.",
    "Return JSON only with the shape:",
    '{"summary":"...","confidence":0.0,"importance":0.0}',
    "Rules:",
    "- MUST write in Simplified Chinese (简体中文).",
    "- Write 3 to 6 sentences in plain language.",
    "- Preserve the important emotional, relational, and factual progression across the source summaries.",
    "- This large summary should be broader than any single small summary.",
    "- Do not list every source summary separately.",
    "- Do not invent facts that are not supported by the source summaries.",
    "",
    "Source small summaries:"
  ];

  records.forEach((record, index) => {
    lines.push(
      `${index + 1}. (${record.firstMessageAt || record.createdAt || ""} -> ${
        record.lastMessageAt || record.updatedAt || ""
      }) ${record.content}`
    );
  });

  return lines.join("\n");
}

async function summarizeLargeSummary(records) {
  const responseText = await callGeminiJson(buildLargeSummaryPrompt(records));
  let parsed = { summary: "" };

  if (responseText) {
    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      throw new Error(
        `Failed to parse large-summary JSON: ${error.message}`
      );
    }
  }

  if (
    !parsed ||
    typeof parsed.summary !== "string" ||
    !parsed.summary.trim() ||
    !passesScoreGate(parsed)
  ) {
    return null;
  }

  return {
    content: parsed.summary.trim(),
    confidence: normalizeScore(parsed.confidence),
    importance: normalizeScore(parsed.importance)
  };
}

function buildCloudEntry(record) {
  return {
    fingerprint: record.id,
    source_channel: record.sourceChannel || "",
    source_ref: record.sourceRef || "",
    summary: record.content,
    detail: "",
    reason: `Auto-generated ${record.kind || record.section}`,
    confidence: record.metadata && typeof record.metadata.confidence === "number"
      ? record.metadata.confidence : null,
    status: "approved",
    metadata: {
      independentSection: record.section,
      section: record.section,
      kind: record.kind,
      title: record.title,
      firstMessageAt: record.firstMessageAt,
      lastMessageAt: record.lastMessageAt,
      batchStart: record.batchStart,
      batchEnd: record.batchEnd,
      messageCount: record.messageCount,
      importance: record.metadata && record.metadata.importance,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  };
}

async function uploadRecordsToCloud(records) {
  if (records.length === 0) return;
  const config = getSharedMemoryConfig();
  const entriesUrl = getMemoryEntriesUrl(config.apiUrl);
  if (!entriesUrl || !config.syncToken) return;

  const entries = records.map(buildCloudEntry);
  try {
    await httpRequestJson(entriesUrl, {
      method: "POST",
      timeoutMs: 15000,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Memory-Sync-Token": config.syncToken,
        "X-Memory-Client": "memory-ingest"
      },
      body: JSON.stringify({ entries })
    });
  } catch (error) {
    // Cloud upload is best-effort; local records are the source of truth.
    process.stderr.write(
      `[memory-ingest] cloud upload failed: ${
        error && error.message ? error.message : String(error)
      }\n`
    );
  }
}

async function processSource(source) {
  const batches = createPendingBatches(source);
  const createdRecords = [];
  let processedMessageCount = source.processedMessageCount;

  for (const batch of batches) {
    const summary = await summarizeSmallBatch(batch);
    if (!summary) {
      continue;
    }

    const saved = createRecord({
      section: "small_summary",
      kind: "small_summary",
      title: summary.title,
      content: summary.content,
      sourceChannel: batch.sourceChannel,
      sourceRef: batch.sourceRef,
      firstMessageAt: batch.firstMessageAt,
      lastMessageAt: batch.lastMessageAt,
      batchStart: batch.startIndex,
      batchEnd: batch.endIndex,
      messageCount: batch.messages.length,
      metadata: {
        confidence: summary.confidence,
        importance: summary.importance
      }
    });

    createdRecords.push(saved);
    processedMessageCount = batch.endIndex + 1;
  }

  // Upload newly created small summaries to cloud so the web UI can see them
  await uploadRecordsToCloud(createdRecords);

  return {
    createdRecords,
    processedMessageCount
  };
}

async function consolidateLargeSummaries() {
  const createdLargeSummaries = [];
  const trashedSmallSummaries = [];

  // 记忆摄取现在只服务 Telegram。旧的 CLI 摘要即使还留在文件夹里，
  // 也不会再参与后续的大摘要合并，避免两套上下文重新缠在一起。
  let activeSmallSummaries = listRecords("small_summary").filter(
    (record) => (record.sourceChannel || "telegram") === "telegram"
  );
  let channels = [...new Set(activeSmallSummaries.map(r => r.sourceChannel || "unknown"))];

  for (const channel of channels) {
    let channelSummaries = activeSmallSummaries.filter(r => (r.sourceChannel || "unknown") === channel);

    // We wait until there are 16 active small summaries for this channel, then consume the oldest
    // 15 into one large summary and leave the newest one as the seed for the next
    // accumulation cycle. This matches the user-defined memory lifecycle.
    while (channelSummaries.length >= LARGE_SUMMARY_TRIGGER_COUNT) {
      const sourceRecords = channelSummaries.slice(0, LARGE_SUMMARY_SOURCE_COUNT);
      const signature = createGenerationSignature(sourceRecords.map((item) => item.id));

      let shouldTrashSourceRecords = hasLargeSummarySignature(signature);

      if (!shouldTrashSourceRecords) {
        const summary = await summarizeLargeSummary(sourceRecords);
        // Do not move small summaries to trash unless a large summary actually
        // exists. Gemini can occasionally return an empty/filtered summary; in
        // that case we keep the edited small summaries active so the user can
        // review them or retry instead of silently losing the source batch.
        if (!summary) {
          break; // break out of the while loop for this channel
        }

        const saved = createRecord({
          section: "large_summary",
          kind: "large_summary",
          title: `${channel} large summary`,
          content: summary.content,
          sourceChannel: channel,
          firstMessageAt: sourceRecords[0].firstMessageAt || sourceRecords[0].createdAt,
          lastMessageAt:
            sourceRecords[sourceRecords.length - 1].lastMessageAt ||
            sourceRecords[sourceRecords.length - 1].updatedAt,
          copiedFrom: "",
          derivedFrom: sourceRecords.map((item) => item.id),
          messageCount: sourceRecords.reduce(
            (total, item) => total + (Number(item.messageCount) || 0),
            0
          ),
          generationSignature: signature,
          metadata: {
            sourceSmallSummaryCount: sourceRecords.length,
            confidence: summary.confidence,
            importance: summary.importance
          }
        });
        createdLargeSummaries.push(saved);
        markLargeSummarySignature(signature, saved.id);
        // Upload large summary to cloud
        await uploadRecordsToCloud([saved]);
        shouldTrashSourceRecords = true;
      }

      if (shouldTrashSourceRecords) {
        for (const record of sourceRecords) {
          trashedSmallSummaries.push(
            moveRecordToTrash(record, {
              trashReason: "merged_into_large_summary",
              mergedIntoSignature: signature
            })
          );
        }
      }

      // 刷新 Telegram 小摘要列表，继续保持 Telegram-only 的合并边界。
      activeSmallSummaries = listRecords("small_summary").filter(
        (record) => (record.sourceChannel || "telegram") === "telegram"
      );
      channelSummaries = activeSmallSummaries.filter(r => (r.sourceChannel || "unknown") === channel);
    }
  }

  return {
    createdLargeSummaries,
    trashedSmallSummaries
  };
}

async function main() {
  ensureMemoryStructure();
  migrateLegacySmallSummaryStore();
  const sourceArgIndex = process.argv.indexOf("--source");
  const sourceType =
    sourceArgIndex >= 0 && process.argv[sourceArgIndex + 1]
      ? process.argv[sourceArgIndex + 1]
      : "telegram";
  if (sourceType === "cli") {
    throw new Error(
      "memory-ingest.cjs 已改为 Telegram-only，不再摄取 Gemini CLI 聊天记录。"
    );
  }
  if (sourceType !== "telegram" && sourceType !== "all") {
    throw new Error(`Unsupported memory source: ${sourceType}`);
  }
  const chatIdIndex = process.argv.indexOf("--chat-id");
  const chatId =
    chatIdIndex >= 0 && process.argv[chatIdIndex + 1]
      ? process.argv[chatIdIndex + 1]
      : "";

  const state = loadIngestState();
  const sources = [];

  if (sourceType === "telegram" || sourceType === "all") {
    sources.push(...collectTelegramSources(state, chatId));
  }

  const processedSources = [];
  let createdSmallSummaryCount = 0;

  for (const source of sources) {
    const result = await processSource(source);
    createdSmallSummaryCount += result.createdRecords.length;

    const channelState = state[source.sourceChannel] || {};
    channelState[source.sourceRef] = {
      lastUpdated: source.updatedAt,
      processedMessageCount: result.processedMessageCount
    };
    state[source.sourceChannel] = channelState;

    processedSources.push({
      sourceChannel: source.sourceChannel,
      sourceRef: source.sourceRef,
      updatedAt: source.updatedAt,
      totalMessages: source.messages.length,
      processedMessageCount: result.processedMessageCount,
      createdSmallSummaryCount: result.createdRecords.length
    });
  }

  const consolidation = await consolidateLargeSummaries();
  const deletedTrashFiles = deleteExpiredTrash();

  saveIngestState(state);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        model: INGEST_MODEL,
        scoreGateEnabled: ENABLE_SCORE_GATING,
        smallSummaryBatchSize: SMALL_SUMMARY_BATCH_SIZE,
        largeSummarySourceCount: LARGE_SUMMARY_SOURCE_COUNT,
        largeSummaryTriggerCount: LARGE_SUMMARY_TRIGGER_COUNT,
        processedSources,
        createdSmallSummaryCount,
        createdLargeSummaryCount: consolidation.createdLargeSummaries.length,
        trashedSmallSummaryCount: consolidation.trashedSmallSummaries.length,
        deletedTrashCount: deletedTrashFiles.length
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
