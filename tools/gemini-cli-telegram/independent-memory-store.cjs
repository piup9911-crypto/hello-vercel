const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ROOT } = require("./cloud-memory-client.cjs");

const MEMORY_ROOT = path.join(ROOT, "memory-docs");
const SMALL_SUMMARY_DIR = path.join(MEMORY_ROOT, "small-summaries");
const LARGE_SUMMARY_DIR = path.join(MEMORY_ROOT, "large-summaries");
const LONG_TERM_DIR = path.join(MEMORY_ROOT, "long-term");
const PRIVATE_DIR = path.join(MEMORY_ROOT, "private");
const TRASH_DIR = path.join(MEMORY_ROOT, "trash");
const GENERATED_DIR = path.join(MEMORY_ROOT, "generated");
const INDEPENDENT_MEMORY_INDEX_PATH = path.join(MEMORY_ROOT, "index.json");
const LEGACY_SMALL_SUMMARY_STORE_PATH = path.join(
  ROOT,
  "bridge-state",
  "small-summaries.json"
);

const MEMORY_META_OPEN = "<!-- MEMORY_META";
const MEMORY_META_CLOSE = "-->";
// Trash retention starts from trashedAt, not from the original memory date.
// This matches the user's rule: a trashed item is kept for half a year after it
// enters trash, so old memories are not deleted immediately just because their
// original content date is old.
const TRASH_RETENTION_DAYS = 180;

const SECTION_TO_DIR = {
  small_summary: SMALL_SUMMARY_DIR,
  large_summary: LARGE_SUMMARY_DIR,
  long_term: LONG_TERM_DIR,
  private: PRIVATE_DIR,
  trash: TRASH_DIR
};
const MEMORY_SECTIONS = Object.freeze(Object.keys(SECTION_TO_DIR));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureMemoryStructure() {
  for (const dirPath of Object.values(SECTION_TO_DIR)) {
    ensureDir(dirPath);
  }
  ensureDir(GENERATED_DIR);
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createMemoryId() {
  return crypto.randomBytes(16).toString("hex");
}

function safeSlug(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "memory";
}

function buildMemoryFileName(record) {
  const createdAt = String(record.createdAt || new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const slug = safeSlug(record.title || record.kind || record.section);
  return `${createdAt}__${slug}__${String(record.id || "").slice(0, 8)}.md`;
}

function normalizeRecord(record) {
  const now = new Date().toISOString();
  return {
    id: String(record.id || createMemoryId()),
    section: String(record.section || "small_summary"),
    kind: String(record.kind || record.section || "small_summary"),
    title: String(record.title || ""),
    content: String(record.content || "").trim(),
    createdAt: String(record.createdAt || now),
    updatedAt: String(record.updatedAt || now),
    trashedAt: record.trashedAt ? String(record.trashedAt) : "",
    sourceChannel: String(record.sourceChannel || ""),
    sourceRef: String(record.sourceRef || ""),
    firstMessageAt: String(record.firstMessageAt || ""),
    lastMessageAt: String(record.lastMessageAt || ""),
    batchStart: Number.isInteger(record.batchStart) ? record.batchStart : null,
    batchEnd: Number.isInteger(record.batchEnd) ? record.batchEnd : null,
    messageCount: Number.isInteger(record.messageCount) ? record.messageCount : 0,
    copiedFrom: String(record.copiedFrom || ""),
    derivedFrom: Array.isArray(record.derivedFrom)
      ? record.derivedFrom.map((item) => String(item || "")).filter(Boolean)
      : [],
    generationSignature: String(record.generationSignature || ""),
    metadata: record.metadata && typeof record.metadata === "object"
      ? record.metadata
      : {}
  };
}

function serializeRecord(record) {
  const normalized = normalizeRecord(record);
  // Store metadata inside an HTML comment so each memory remains a normal
  // editable Markdown file while still carrying lifecycle fields for the tools.
  const metadata = {
    id: normalized.id,
    section: normalized.section,
    kind: normalized.kind,
    title: normalized.title,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    trashedAt: normalized.trashedAt,
    sourceChannel: normalized.sourceChannel,
    sourceRef: normalized.sourceRef,
    firstMessageAt: normalized.firstMessageAt,
    lastMessageAt: normalized.lastMessageAt,
    batchStart: normalized.batchStart,
    batchEnd: normalized.batchEnd,
    messageCount: normalized.messageCount,
    copiedFrom: normalized.copiedFrom,
    derivedFrom: normalized.derivedFrom,
    generationSignature: normalized.generationSignature,
    metadata: normalized.metadata
  };

  return [
    MEMORY_META_OPEN,
    JSON.stringify(metadata, null, 2),
    MEMORY_META_CLOSE,
    "",
    normalized.content,
    ""
  ].join("\n");
}

function parseRecordText(text) {
  const normalizedText = String(text || "");
  if (!normalizedText.startsWith(MEMORY_META_OPEN)) {
    return null;
  }

  const closeIndex = normalizedText.indexOf(MEMORY_META_CLOSE);
  if (closeIndex === -1) {
    return null;
  }

  const metadataText = normalizedText
    .slice(MEMORY_META_OPEN.length, closeIndex)
    .trim();
  const body = normalizedText.slice(closeIndex + MEMORY_META_CLOSE.length).trim();

  try {
    const metadata = JSON.parse(metadataText);
    return normalizeRecord({
      ...metadata,
      content: body
    });
  } catch {
    return null;
  }
}

function getSectionDirectory(section) {
  const directory = SECTION_TO_DIR[section];
  if (!directory) {
    throw new Error(`Unknown memory section: ${section}`);
  }
  return directory;
}

function listSectionFiles(section) {
  const directory = getSectionDirectory(section);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(directory, name));
}

function readRecord(filePath) {
  const parsed = parseRecordText(readText(filePath, ""));
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    filePath
  };
}

function listRecords(section) {
  return listSectionFiles(section)
    .map((filePath) => readRecord(filePath))
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = new Date(left.lastMessageAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.lastMessageAt || right.createdAt || 0).getTime();
      return leftTime - rightTime;
    });
}

function saveRecord(record, preferredDirectory) {
  const normalized = normalizeRecord(record);
  const directory = preferredDirectory || getSectionDirectory(normalized.section);
  const fileName =
    normalized.filePath && path.dirname(normalized.filePath) === directory
      ? path.basename(normalized.filePath)
      : buildMemoryFileName(normalized);
  const filePath = path.join(directory, fileName);

  writeText(filePath, serializeRecord(normalized));
  return {
    ...normalized,
    filePath
  };
}

function createRecord(record) {
  ensureMemoryStructure();
  return saveRecord(record);
}

function updateRecord(record, updates = {}) {
  return saveRecord({
    ...record,
    ...updates,
    updatedAt: new Date().toISOString()
  });
}

function moveRecordToTrash(record, extraMetadata = {}) {
  // Trash is the only lifecycle operation that removes the active source file.
  // Copies into long_term/private use cloneRecordToSection() instead and must
  // stay independent, because the user wants each region to be editable without
  // hidden synchronization.
  const nextRecord = normalizeRecord({
    ...record,
    section: "trash",
    trashedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(record.metadata || {}),
      ...extraMetadata
    }
  });

  const saved = saveRecord(nextRecord, TRASH_DIR);
  if (record.filePath && path.resolve(record.filePath) !== path.resolve(saved.filePath)) {
    try {
      fs.unlinkSync(record.filePath);
    } catch {}
  }
  return saved;
}

function cloneRecordToSection(record, section, overrides = {}) {
  // Cloning intentionally creates a new independent memory. The copiedFrom field
  // is only provenance metadata; edits must never propagate back to the source.
  return createRecord({
    ...record,
    ...overrides,
    id: createMemoryId(),
    section,
    kind: section,
    copiedFrom: record.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trashedAt: "",
    filePath: undefined
  });
}

function createGenerationSignature(recordIds) {
  return crypto
    .createHash("sha256")
    .update(recordIds.join("|"))
    .digest("hex");
}

function loadIndex() {
  return readText(INDEPENDENT_MEMORY_INDEX_PATH, "").trim()
    ? JSON.parse(readText(INDEPENDENT_MEMORY_INDEX_PATH, "{}"))
    : {};
}

function saveIndex(index) {
  writeJson(INDEPENDENT_MEMORY_INDEX_PATH, index);
}

function listAllRecords() {
  return [
    ...listRecords("small_summary"),
    ...listRecords("large_summary"),
    ...listRecords("long_term"),
    ...listRecords("private"),
    ...listRecords("trash")
  ];
}

function getRecordById(recordId) {
  const normalizedId = String(recordId || "").trim();
  if (!normalizedId) {
    return null;
  }

  return listAllRecords().find((record) => record.id === normalizedId) || null;
}

function deleteRecord(record) {
  const target = typeof record === "string" ? getRecordById(record) : record;
  if (!target || !target.filePath) {
    return false;
  }

  try {
    fs.unlinkSync(target.filePath);
    return true;
  } catch {
    return false;
  }
}

function migrateLegacySmallSummaryStore() {
  ensureMemoryStructure();
  const index = loadIndex();
  if (index.legacySmallSummaryMigrated) {
    return {
      migratedCount: 0,
      skipped: true
    };
  }

  if (!fs.existsSync(LEGACY_SMALL_SUMMARY_STORE_PATH)) {
    index.legacySmallSummaryMigrated = {
      at: new Date().toISOString(),
      foundLegacyFile: false
    };
    saveIndex(index);
    return {
      migratedCount: 0,
      skipped: true
    };
  }

  let migratedCount = 0;
  const existingIds = new Set(listAllRecords().map((record) => record.id));
  const raw = JSON.parse(readText(LEGACY_SMALL_SUMMARY_STORE_PATH, "{}"));
  const sources = raw && raw.sources && typeof raw.sources === "object"
    ? raw.sources
    : {};

  for (const [sourceRef, sourceValue] of Object.entries(sources)) {
    const sourceChannel = String(sourceValue && sourceValue.sourceChannel || "");
    const summaries = Array.isArray(sourceValue && sourceValue.summaries)
      ? sourceValue.summaries
      : [];

    for (const item of summaries) {
      if (!item || !item.id || existingIds.has(item.id)) {
        continue;
      }

      createRecord({
        id: String(item.id),
        section: "small_summary",
        kind: "small_summary",
        title: `${sourceChannel || "legacy"} small summary`,
        content: String(item.summary || "").trim(),
        createdAt: String(item.createdAt || new Date().toISOString()),
        updatedAt: String(item.createdAt || new Date().toISOString()),
        sourceChannel,
        sourceRef,
        firstMessageAt: String(item.firstMessageAt || ""),
        lastMessageAt: String(item.lastMessageAt || ""),
        batchStart: Number.isInteger(item.startIndex) ? item.startIndex : null,
        batchEnd: Number.isInteger(item.endIndex) ? item.endIndex : null,
        messageCount: Number.isInteger(item.messageCount) ? item.messageCount : 0,
        metadata: {
          migratedFromLegacyStore: true,
          confidence: item.confidence,
          importance: item.importance
        }
      });
      existingIds.add(String(item.id));
      migratedCount += 1;
    }
  }

  index.legacySmallSummaryMigrated = {
    at: new Date().toISOString(),
    foundLegacyFile: true,
    migratedCount
  };
  saveIndex(index);
  return {
    migratedCount,
    skipped: false
  };
}

function hasLargeSummarySignature(signature) {
  const index = loadIndex();
  const signatures = index.largeSummarySignatures || {};
  return Boolean(signatures[signature]);
}

function markLargeSummarySignature(signature, largeSummaryId) {
  const index = loadIndex();
  const signatures = index.largeSummarySignatures || {};
  signatures[signature] = {
    largeSummaryId,
    createdAt: new Date().toISOString()
  };
  index.largeSummarySignatures = signatures;
  saveIndex(index);
}

function deleteExpiredTrash() {
  ensureMemoryStructure();
  const cutoffMs = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const deleted = [];

  for (const record of listRecords("trash")) {
    // Expiry is based on trashedAt. updatedAt is only a fallback for older
    // records that may not have the field from before the trash lifecycle
    // existed.
    const trashedAtMs = new Date(record.trashedAt || record.updatedAt || 0).getTime();
    if (!Number.isFinite(trashedAtMs) || trashedAtMs > cutoffMs) {
      continue;
    }

    try {
      fs.unlinkSync(record.filePath);
      deleted.push(record.filePath);
    } catch {}
  }

  return deleted;
}

module.exports = {
  GENERATED_DIR,
  INDEPENDENT_MEMORY_INDEX_PATH,
  LARGE_SUMMARY_DIR,
  LEGACY_SMALL_SUMMARY_STORE_PATH,
  LONG_TERM_DIR,
  MEMORY_SECTIONS,
  MEMORY_ROOT,
  PRIVATE_DIR,
  SMALL_SUMMARY_DIR,
  TRASH_DIR,
  TRASH_RETENTION_DAYS,
  cloneRecordToSection,
  createGenerationSignature,
  createRecord,
  deleteExpiredTrash,
  deleteRecord,
  ensureMemoryStructure,
  getRecordById,
  hasLargeSummarySignature,
  listRecords,
  markLargeSummarySignature,
  migrateLegacySmallSummaryStore,
  moveRecordToTrash,
  normalizeRecord,
  parseRecordText,
  readRecord,
  saveRecord,
  serializeRecord,
  updateRecord,
  writeText
};
