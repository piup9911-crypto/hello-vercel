const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = __dirname;
const REAL_HOME = os.homedir();
const SOURCE_GEMINI_DIR = path.join(REAL_HOME, ".gemini");
const BRIDGE_ENV_PATH = path.join(ROOT, "bridge.env");

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
loadEnvFile(BRIDGE_ENV_PATH, false);

function getSharedMemoryConfig() {
  // LEGACY CLOUD API: this still points at the old pending/approved memory
  // service so we can migrate existing data into the new independent memory
  // system. New automatic memory writes should use `memory-docs/` records
  // instead of creating more old pending/approved entries.
  return {
    apiUrl:
      process.env.SHARED_MEMORY_URL ||
      process.env.BRIDGE_SHARED_MEMORY_URL ||
      "",
    syncToken: process.env.SHARED_MEMORY_SYNC_TOKEN || ""
  };
}

function getMemoryEntriesUrl(apiUrl) {
  if (!apiUrl) return "";
  return apiUrl.replace(/\/shared-memory(?:\?.*)?$/i, "/memory-entries");
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
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              data: parsed,
              raw: data
            });
            return;
          }

          const message =
            (parsed && (parsed.error || parsed.message)) ||
            data ||
            `Request failed with ${res.statusCode}`;
          reject(new Error(message));
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Cloud memory request timed out."));
    });
    req.on("error", (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

async function fetchSharedMemoryBundle(options = {}) {
  // Legacy read-only fetch. The new single-source memory system imports this
  // once via legacy-cloud-memory-migration.cjs, then treats `memory-docs/` as
  // the local source of truth.
  const config = getSharedMemoryConfig();
  const apiUrl = options.apiUrl || config.apiUrl;
  const syncToken = options.syncToken || config.syncToken;

  if (!apiUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "SHARED_MEMORY_URL is not configured."
    };
  }

  if (!syncToken) {
    return {
      ok: false,
      skipped: true,
      reason: "SHARED_MEMORY_SYNC_TOKEN is not configured."
    };
  }

  const response = await httpRequestJson(apiUrl, {
    method: "GET",
    timeoutMs: options.timeoutMs || 15000,
    headers: {
      Accept: "application/json",
      "X-Memory-Sync-Token": syncToken,
      "X-Memory-Client": options.clientName || "local-sync"
    }
  });

  const payload = response.data || {};
  return {
    ok: true,
    apiUrl,
    content: typeof payload.content === "string" ? payload.content : "",
    updatedAt: payload.updatedAt || null,
    approvedEntries: Array.isArray(payload.approvedEntries)
      ? payload.approvedEntries
      : [],
    pendingEntries: Array.isArray(payload.pendingEntries)
      ? payload.pendingEntries
      : []
  };
}

async function postMemoryEntries(entries, options = {}) {
  // Deprecated write path for the old pending/approved cloud system. Keep it
  // available for rollback/debugging, but do not use it for new memory ingest.
  const config = getSharedMemoryConfig();
  const apiUrl = options.apiUrl || config.apiUrl;
  const syncToken = options.syncToken || config.syncToken;
  const entriesUrl = options.entriesUrl || getMemoryEntriesUrl(apiUrl);

  if (!entriesUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "Shared memory entries URL is not configured."
    };
  }

  if (!syncToken) {
    return {
      ok: false,
      skipped: true,
      reason: "SHARED_MEMORY_SYNC_TOKEN is not configured."
    };
  }

  const response = await httpRequestJson(entriesUrl, {
    method: "POST",
    timeoutMs: options.timeoutMs || 15000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Memory-Sync-Token": syncToken,
      "X-Memory-Client": options.clientName || "local-ingest"
    },
    body: JSON.stringify({ entries })
  });

  return {
    ok: true,
    entries: Array.isArray(response.data && response.data.entries)
      ? response.data.entries
      : []
  };
}

module.exports = {
  ROOT,
  SOURCE_GEMINI_DIR,
  BRIDGE_ENV_PATH,
  getSharedMemoryConfig,
  getMemoryEntriesUrl,
  httpRequestJson,
  fetchSharedMemoryBundle,
  postMemoryEntries
};
