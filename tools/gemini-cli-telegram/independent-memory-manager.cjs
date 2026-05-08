const fs = require("fs");
const http = require("http");
const path = require("path");

const {
  MEMORY_SECTIONS,
  cloneRecordToSection,
  deleteExpiredTrash,
  deleteRecord,
  ensureMemoryStructure,
  getRecordById,
  listRecords,
  moveRecordToTrash,
  updateRecord
} = require("./independent-memory-store.cjs");
const { syncSharedMemory } = require("./shared-memory-sync.cjs");

const HOST = process.env.INDEPENDENT_MEMORY_MANAGER_HOST || "127.0.0.1";
const PORT = Math.max(
  1,
  Number.parseInt(process.env.INDEPENDENT_MEMORY_MANAGER_PORT || "4142", 10) || 4142
);
const PAGE_PATH = path.join(__dirname, "independent-memory-manager.html");
const MAX_REQUEST_BYTES = 1024 * 1024;

function log(...args) {
  process.stderr.write(
    `[independent-memory-manager] ${args.map((item) => String(item)).join(" ")}\n`
  );
}

function json(res, status, payload) {
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

function sendNotFound(res, message = "Not found") {
  json(res, 404, { error: message });
}

function listAllSections() {
  return {
    smallSummaries: listRecords("small_summary"),
    largeSummaries: listRecords("large_summary"),
    longTerm: listRecords("long_term"),
    privateMemory: listRecords("private"),
    trash: listRecords("trash")
  };
}

function normalizeEditableString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function validateCloneTarget(section) {
  return section === "long_term" || section === "private";
}

async function readJsonBody(req) {
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

async function rebuildReadableMemory() {
  // The manager edits the independent memory source of truth, so every write
  // must refresh the model-readable compiled files immediately. 现在只刷新
  // Telegram 工作区；普通 Gemini CLI 不再接入这套云端记忆。
  try {
    return await syncSharedMemory();
  } catch (error) {
    // The manager should stay usable even if one compiled output target is
    // temporarily locked or not writable in the current environment. Logging
    // the warning is safer than failing the whole editing surface.
    log(
      "non-fatal sync warning",
      error && error.message ? error.message : String(error)
    );
    return null;
  }
}

async function handleListMemory(req, res) {
  deleteExpiredTrash();
  await rebuildReadableMemory();
  json(res, 200, {
    sections: listAllSections(),
    readableSections: ["smallSummaries", "largeSummaries", "longTerm"],
    excludedSections: ["privateMemory", "trash"]
  });
}

async function handleUpdateRecord(req, res, recordId) {
  const record = getRecordById(recordId);
  if (!record) {
    sendNotFound(res, "Memory record not found.");
    return;
  }

  const payload = await readJsonBody(req);
  const nextTitle = normalizeEditableString(payload.title, record.title);
  const nextContent = normalizeEditableString(payload.content, record.content).trim();

  if (!nextContent) {
    json(res, 400, {
      error: "Memory content cannot be empty."
    });
    return;
  }

  const saved = updateRecord(record, {
    title: nextTitle,
    content: nextContent
  });

  await rebuildReadableMemory();
  json(res, 200, {
    record: saved
  });
}

async function handleCloneRecord(req, res, recordId) {
  const record = getRecordById(recordId);
  if (!record) {
    sendNotFound(res, "Memory record not found.");
    return;
  }

  const payload = await readJsonBody(req);
  const section = String(payload.section || "").trim();
  if (!validateCloneTarget(section)) {
    json(res, 400, {
      error: "Clone target must be long_term or private."
    });
    return;
  }

  // Copies become brand-new independent memories on purpose. The user wants
  // each region to hold its own editable text with no hidden linkage back to
  // the source record after the copy is made.
  const cloned = cloneRecordToSection(record, section, {
    title: normalizeEditableString(payload.title, record.title),
    content: normalizeEditableString(payload.content, record.content).trim()
  });

  await rebuildReadableMemory();
  json(res, 200, {
    record: cloned
  });
}

async function handleTrashRecord(req, res, recordId) {
  const record = getRecordById(recordId);
  if (!record) {
    sendNotFound(res, "Memory record not found.");
    return;
  }

  const trashed = moveRecordToTrash(record, {
    trashedBy: "memory-manager"
  });
  await rebuildReadableMemory();
  json(res, 200, {
    record: trashed
  });
}

async function handleDeleteRecord(req, res, recordId) {
  const record = getRecordById(recordId);
  if (!record) {
    sendNotFound(res, "Memory record not found.");
    return;
  }

  const deleted = deleteRecord(record);
  if (!deleted) {
    json(res, 500, {
      error: "Failed to delete memory record."
    });
    return;
  }

  await rebuildReadableMemory();
  json(res, 200, {
    ok: true,
    deletedId: record.id
  });
}

async function routeRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      Allow: "GET, POST, PATCH, DELETE, OPTIONS"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/memory")) {
    sendHtml(res, fs.readFileSync(PAGE_PATH, "utf8"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "independent-memory-manager",
      host: HOST,
      port: PORT
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/memory") {
    await handleListMemory(req, res);
    return;
  }

  const recordMatch = url.pathname.match(/^\/api\/memory\/([^/]+)$/);
  if (recordMatch && req.method === "PATCH") {
    await handleUpdateRecord(req, res, decodeURIComponent(recordMatch[1]));
    return;
  }

  const cloneMatch = url.pathname.match(/^\/api\/memory\/([^/]+)\/clone$/);
  if (cloneMatch && req.method === "POST") {
    await handleCloneRecord(req, res, decodeURIComponent(cloneMatch[1]));
    return;
  }

  const trashMatch = url.pathname.match(/^\/api\/memory\/([^/]+)\/trash$/);
  if (trashMatch && req.method === "POST") {
    await handleTrashRecord(req, res, decodeURIComponent(trashMatch[1]));
    return;
  }

  if (recordMatch && req.method === "DELETE") {
    await handleDeleteRecord(req, res, decodeURIComponent(recordMatch[1]));
    return;
  }

  sendNotFound(res);
}

async function main() {
  ensureMemoryStructure();
  deleteExpiredTrash();
  await rebuildReadableMemory();

  const server = http.createServer((req, res) => {
    routeRequest(req, res).catch((error) => {
      log(error && error.stack ? error.stack : String(error));
      json(res, 500, {
        error: error && error.message ? error.message : String(error)
      });
    });
  });

  server.listen(PORT, HOST, () => {
    log(`listening on http://${HOST}:${PORT}`);
  });
}

main().catch((error) => {
  log(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
