const fs = require("fs");
const path = require("path");
const {
  ROOT,
  fetchSharedMemoryBundle
} = require("./cloud-memory-client.cjs");
const {
  GENERATED_DIR: MEMORY_GENERATED_DIR,
  ensureMemoryStructure,
  listRecords,
  migrateLegacySmallSummaryStore,
  writeText
} = require("./independent-memory-store.cjs");
const {
  migrateLegacyCloudMemoryOnce
} = require("./legacy-cloud-memory-migration.cjs");

const GENERATED_DIR = path.join(ROOT, "generated");
const DEFAULT_CACHE_PATH = path.join(
  ROOT,
  "bridge-state",
  "shared-memory-cache.json"
);
const DEFAULT_BRIDGE_WORKSPACE = path.join(ROOT, "bridge-workspace");
const INDEPENDENT_MEMORY_FILE_NAME = "INDEPENDENT_MEMORY.md";
const MAX_SMALL_SUMMARIES_FOR_MODEL = 4;
const MAX_LARGE_SUMMARIES_FOR_MODEL = 6;
const MAX_LONG_TERM_FOR_MODEL = 20;
const READABLE_CLOUD_SECTIONS = new Set([
  "long_term",
  "large_summary",
  "small_summary"
]);
const DISABLE_LEGACY_CLOUD_MIGRATION =
  String(process.env.DISABLE_LEGACY_CLOUD_MEMORY_MIGRATION || "false")
    .toLowerCase() === "true";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeTargets(targets) {
  const unique = new Map();
  for (const target of targets || []) {
    if (!target) continue;
    const resolved = path.resolve(target);
    unique.set(resolved.toLowerCase(), resolved);
  }
  return Array.from(unique.values());
}

function renderRecordLine(record) {
  const content = String(record && record.content ? record.content : "").trim();
  if (!content) {
    return "";
  }
  return `- ${content}`;
}

function normalizeMemoryContent(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function memoryContentKey(value) {
  return normalizeMemoryContent(value).replace(/\s+/g, " ").toLowerCase();
}

function looksLikeCorruptEncoding(value) {
  const text = normalizeMemoryContent(value);
  if (!text) {
    return false;
  }

  // Old cloud rows can contain mojibake from a bad UTF-8/legacy-codepage round
  // trip. Filtering them here keeps generated memory clean even if the stale
  // cloud rows are still present and would otherwise be re-merged on restart.
  return /[\uFFFD]|\u951f\u65a4\u62f7|\u951f/.test(text);
}

function getRecordTime(record) {
  const timestamp =
    record && (record.lastMessageAt || record.updatedAt || record.createdAt);
  const time = new Date(timestamp || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function extractCloudEntryContent(entry) {
  if (typeof entry === "string") {
    return normalizeMemoryContent(entry);
  }

  if (!entry || typeof entry !== "object") {
    return "";
  }

  for (const field of ["summary", "content", "memory", "text", "value"]) {
    if (typeof entry[field] === "string" && entry[field].trim()) {
      return normalizeMemoryContent(entry[field]);
    }
  }

  return "";
}

function getCloudEntryMetadata(entry) {
  return entry && entry.metadata && typeof entry.metadata === "object"
    ? entry.metadata
    : {};
}

function getCloudEntrySection(entry) {
  const metadata = getCloudEntryMetadata(entry);
  const section = String(
    metadata.independentSection ||
      metadata.section ||
      entry.section ||
      "long_term"
  ).trim();
  return READABLE_CLOUD_SECTIONS.has(section) ? section : "";
}

function getCloudEntryUpdatedAt(entry) {
  const metadata = getCloudEntryMetadata(entry);
  return String(
    entry.updated_at ||
      entry.updatedAt ||
      metadata.updatedAt ||
      metadata.createdAt ||
      ""
  );
}

function collectCloudReadableRecords(bundle) {
  const records = {
    long_term: [],
    large_summary: [],
    small_summary: []
  };

  const sharedContent = normalizeMemoryContent(bundle && bundle.content);
  if (sharedContent) {
    records.long_term.push({
      content: sharedContent,
      updatedAt: bundle.updatedAt || "",
      sourceChannel: "cloud_shared_memory",
      sourceRef: "shared-memory.content"
    });
  }

  const approvedEntries = Array.isArray(bundle && bundle.approvedEntries)
    ? bundle.approvedEntries
    : [];

  for (const entry of approvedEntries) {
    const section = getCloudEntrySection(entry);
    const content = extractCloudEntryContent(entry);
    if (!section || !content) {
      continue;
    }

    records[section].push({
      content,
      updatedAt: getCloudEntryUpdatedAt(entry),
      sourceChannel: "cloud_independent_memory",
      sourceRef: String(entry.id || "")
    });
  }

  return records;
}

function mergeRecordsForModel(localRecords, cloudRecords, maxCount) {
  const seen = new Set();
  const merged = [];

  // Local markdown remains the editable source for automatic summaries. Cloud
  // records are appended after de-duplication so manual web edits become visible
  // to Telegram without forcing them into local files or duplicating old
  // one-time migration records.
  for (const record of [...(localRecords || []), ...(cloudRecords || [])]) {
    if (looksLikeCorruptEncoding(record && record.content)) {
      continue;
    }

    const key = memoryContentKey(record && record.content);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(record);
  }

  return merged
    .sort((left, right) => getRecordTime(left) - getRecordTime(right))
    .slice(-maxCount);
}

function buildIndependentMemoryLibrary(options = {}) {
  ensureMemoryStructure();
  const cloudReadableMemory = options.cloudReadableMemory || {};
  const longTerm = mergeRecordsForModel(
    listRecords("long_term"),
    cloudReadableMemory.long_term,
    MAX_LONG_TERM_FOR_MODEL
  );
  const largeSummaries = mergeRecordsForModel(
    listRecords("large_summary"),
    cloudReadableMemory.large_summary,
    MAX_LARGE_SUMMARIES_FOR_MODEL
  );
  const smallSummaries = mergeRecordsForModel(
    listRecords("small_summary"),
    cloudReadableMemory.small_summary,
    MAX_SMALL_SUMMARIES_FOR_MODEL
  );
  const lines = ["## Independent Memory", ""];

  // 这里是 Telegram 专用的可读记忆层。Gemini CLI 本体不再读取或生成这份文件，
  // 避免 CLI 工作上下文和 Telegram 聊天上下文继续互相污染。
  if (longTerm.length > 0) {
    lines.push("Long-term memory:");
    for (const record of longTerm) {
      const line = renderRecordLine(record);
      if (line) {
        lines.push(line);
      }
    }
    lines.push("");
  }

  if (largeSummaries.length > 0) {
    lines.push("Large summaries:");
    for (const record of largeSummaries) {
      const line = renderRecordLine(record);
      if (line) {
        lines.push(line);
      }
    }
    lines.push("");
  }

  if (smallSummaries.length > 0) {
    lines.push("Recent small summaries:");
    for (const record of smallSummaries) {
      const line = renderRecordLine(record);
      if (line) {
        lines.push(line);
      }
    }
    lines.push("");
  }

  if (
    longTerm.length === 0 &&
    largeSummaries.length === 0 &&
    smallSummaries.length === 0
  ) {
    lines.push("(empty)");
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function migrateLegacyCloudIfNeeded(options = {}) {
  if (DISABLE_LEGACY_CLOUD_MIGRATION || options.migrateLegacyCloud === false) {
    return {
      ok: true,
      skipped: true,
      reason: "Legacy cloud memory migration is disabled."
    };
  }

  try {
    // The old pending/approved cloud system is no longer a source of truth.
    // During sync we import it once into the new independent memory layout:
    // approved/shared content -> long_term, pending -> private by default.
    // This keeps user data while making `memory-docs/` the single local model.
    return await migrateLegacyCloudMemoryOnce({
      clientName: "shared-memory-sync",
      pendingTarget: options.legacyPendingTarget || "private",
      timeoutMs: options.legacyMigrationTimeoutMs || 8000
    });
  } catch (error) {
    return {
      ok: false,
      skipped: true,
      reason: error && error.message ? error.message : String(error)
    };
  }
}

async function fetchCloudReadableMemory(options = {}) {
  if (options.includeCloudReadableMemory === false) {
    return {
      ok: true,
      skipped: true,
      reason: "Cloud readable memory merge is disabled.",
      records: {
        long_term: [],
        large_summary: [],
        small_summary: []
      }
    };
  }

  try {
    const bundle = await fetchSharedMemoryBundle({
      clientName: options.clientName || "shared-memory-sync",
      // Vercel can be cold when the bridge starts. Keep this longer than the
      // old one-time migration timeout so cloud-edited memories are not skipped
      // just because the site needed a few extra seconds to wake up.
      timeoutMs: options.cloudReadableMemoryTimeoutMs || 20000
    });
    if (!bundle.ok) {
      return {
        ...bundle,
        records: {
          long_term: [],
          large_summary: [],
          small_summary: []
        }
      };
    }

    const records = collectCloudReadableRecords(bundle);
    return {
      ok: true,
      skipped: false,
      apiUrl: bundle.apiUrl,
      updatedAt: bundle.updatedAt,
      counts: {
        longTerm: records.long_term.length,
        largeSummaries: records.large_summary.length,
        smallSummaries: records.small_summary.length
      },
      records
    };
  } catch (error) {
    // Cloud memory is a helpful source, but the bridge must still start when
    // the network or Vercel is unavailable. Local memory-docs remain usable.
    return {
      ok: false,
      skipped: true,
      reason: error && error.message ? error.message : String(error),
      records: {
        long_term: [],
        large_summary: [],
        small_summary: []
      }
    };
  }
}

async function syncSharedMemory(options = {}) {
  ensureMemoryStructure();
  migrateLegacySmallSummaryStore();
  const legacyCloudMigration = await migrateLegacyCloudIfNeeded(options);
  const cloudReadableMemory = await fetchCloudReadableMemory(options);
  ensureDir(GENERATED_DIR);

  const independentMemoryLibrary = buildIndependentMemoryLibrary({
    cloudReadableMemory: cloudReadableMemory.records
  });

  writeText(
    path.join(MEMORY_GENERATED_DIR, "independent-memory.md"),
    independentMemoryLibrary
  );

  const targets = normalizeTargets(
    options.targets || [DEFAULT_BRIDGE_WORKSPACE]
  );
  const writtenFiles = [];

  for (const targetDir of targets) {
    const filePath = path.join(targetDir, INDEPENDENT_MEMORY_FILE_NAME);
    writeText(filePath, independentMemoryLibrary);
    writtenFiles.push(filePath);
  }

  const cachePath = options.cachePath || DEFAULT_CACHE_PATH;
  writeJson(cachePath, {
    syncedAt: new Date().toISOString(),
    targets: writtenFiles,
    generated: {
      independentMemory: path.join(
        MEMORY_GENERATED_DIR,
        "independent-memory.md"
      )
    },
    counts: {
      longTerm: listRecords("long_term").length,
      largeSummaries: listRecords("large_summary").length,
      smallSummaries: listRecords("small_summary").length,
      privateMemory: listRecords("private").length,
      trash: listRecords("trash").length
    },
    legacyCloudMigration,
    cloudReadableMemory: {
      ok: cloudReadableMemory.ok,
      skipped: cloudReadableMemory.skipped,
      reason: cloudReadableMemory.reason || "",
      updatedAt: cloudReadableMemory.updatedAt || null,
      counts: cloudReadableMemory.counts || {
        longTerm: 0,
        largeSummaries: 0,
        smallSummaries: 0
      }
    }
  });

  return {
    ok: true,
    writtenFiles,
    independentMemoryPath: path.join(
      MEMORY_GENERATED_DIR,
      "independent-memory.md"
    ),
    legacyCloudMigration,
    cloudReadableMemory: {
      ok: cloudReadableMemory.ok,
      skipped: cloudReadableMemory.skipped,
      reason: cloudReadableMemory.reason || "",
      updatedAt: cloudReadableMemory.updatedAt || null,
      counts: cloudReadableMemory.counts || {
        longTerm: 0,
        largeSummaries: 0,
        smallSummaries: 0
      }
    }
  };
}

async function main() {
  try {
    const result = await syncSharedMemory();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 2);
  } catch (error) {
    process.stderr.write(
      `${error && error.message ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_BRIDGE_WORKSPACE,
  DEFAULT_CACHE_PATH,
  INDEPENDENT_MEMORY_FILE_NAME,
  buildIndependentMemoryLibrary,
  collectCloudReadableRecords,
  fetchCloudReadableMemory,
  migrateLegacyCloudIfNeeded,
  syncSharedMemory
};
