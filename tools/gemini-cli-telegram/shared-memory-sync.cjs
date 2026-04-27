const fs = require("fs");
const os = require("os");
const path = require("path");
const { ROOT } = require("./cloud-memory-client.cjs");
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

const REAL_HOME = os.homedir();
const GENERATED_DIR = path.join(ROOT, "generated");
const DEFAULT_CACHE_PATH = path.join(
  ROOT,
  "bridge-state",
  "shared-memory-cache.json"
);
const DEFAULT_CLI_WORKSPACE = path.join(REAL_HOME, "gemini-test");
const DEFAULT_BRIDGE_WORKSPACE = path.join(ROOT, "bridge-workspace");
const HOME_GEMINI_MD_PATH = path.join(REAL_HOME, ".gemini", "GEMINI.md");
const INDEPENDENT_MEMORY_FILE_NAME = "INDEPENDENT_MEMORY.md";
const MAX_SMALL_SUMMARIES_FOR_MODEL = 4;
const MAX_LARGE_SUMMARIES_FOR_MODEL = 6;
const MAX_LONG_TERM_FOR_MODEL = 20;
const DISABLE_LEGACY_CLOUD_MIGRATION =
  String(process.env.DISABLE_LEGACY_CLOUD_MEMORY_MIGRATION || "false")
    .toLowerCase() === "true";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
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

function buildIndependentMemoryLibrary() {
  ensureMemoryStructure();
  const longTerm = listRecords("long_term").slice(-MAX_LONG_TERM_FOR_MODEL);
  const largeSummaries = listRecords("large_summary").slice(
    -MAX_LARGE_SUMMARIES_FOR_MODEL
  );
  const smallSummaries = listRecords("small_summary").slice(
    -MAX_SMALL_SUMMARIES_FOR_MODEL
  );
  const lines = ["## Independent Memory", ""];

  // GEMINI.md stays manual-only. This compiled document is the flexible layer
  // that both Telegram and CLI can read without mutating the user's own md file.
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

function buildCliBootstrapPrompt(independentMemoryLibrary) {
  return [
    "Load the following independent memory context for this interactive session.",
    "Treat it as editable working memory that is separate from GEMINI.md.",
    "Do not repeat it to the user unless it becomes relevant.",
    "",
    independentMemoryLibrary.trim()
  ].join("\n");
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

async function syncSharedMemory(options = {}) {
  ensureMemoryStructure();
  migrateLegacySmallSummaryStore();
  const legacyCloudMigration = await migrateLegacyCloudIfNeeded(options);
  ensureDir(GENERATED_DIR);

  const homePersona = readText(options.homeGeminiPath || HOME_GEMINI_MD_PATH, "");
  const independentMemoryLibrary = buildIndependentMemoryLibrary();
  const cliBootstrapPrompt = buildCliBootstrapPrompt(independentMemoryLibrary);

  writeText(
    path.join(GENERATED_DIR, "manual-gemini.md"),
    `${homePersona.trim()}\n`
  );
  writeText(
    path.join(MEMORY_GENERATED_DIR, "independent-memory.md"),
    independentMemoryLibrary
  );
  writeText(
    path.join(MEMORY_GENERATED_DIR, "cli-bootstrap-prompt.txt"),
    `${cliBootstrapPrompt.trim()}\n`
  );

  const targets = normalizeTargets(
    options.targets || [DEFAULT_BRIDGE_WORKSPACE, DEFAULT_CLI_WORKSPACE]
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
      manualGemini: path.join(GENERATED_DIR, "manual-gemini.md"),
      independentMemory: path.join(
        MEMORY_GENERATED_DIR,
        "independent-memory.md"
      ),
      cliBootstrapPrompt: path.join(
        MEMORY_GENERATED_DIR,
        "cli-bootstrap-prompt.txt"
      )
    },
    counts: {
      longTerm: listRecords("long_term").length,
      largeSummaries: listRecords("large_summary").length,
      smallSummaries: listRecords("small_summary").length,
      privateMemory: listRecords("private").length,
      trash: listRecords("trash").length
    },
    legacyCloudMigration
  });

  return {
    ok: true,
    writtenFiles,
    manualGeminiPath: path.join(GENERATED_DIR, "manual-gemini.md"),
    independentMemoryPath: path.join(
      MEMORY_GENERATED_DIR,
      "independent-memory.md"
    ),
    cliBootstrapPromptPath: path.join(
      MEMORY_GENERATED_DIR,
      "cli-bootstrap-prompt.txt"
    ),
    legacyCloudMigration
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
  DEFAULT_CLI_WORKSPACE,
  HOME_GEMINI_MD_PATH,
  INDEPENDENT_MEMORY_FILE_NAME,
  buildCliBootstrapPrompt,
  buildIndependentMemoryLibrary,
  migrateLegacyCloudIfNeeded,
  syncSharedMemory
};
