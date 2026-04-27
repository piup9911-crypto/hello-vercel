import {
  authorizeRequest,
  deleteMemoryEntry,
  getSharedMemory,
  json,
  listMemoryEntries,
  patchMemoryEntry,
  putSharedMemory,
  readConfig,
  upsertMemoryEntries
} from "./_memory-shared.mjs";

const READABLE_SECTIONS = new Set(["long_term", "large_summary", "small_summary"]);
const ALL_SECTIONS = new Set([
  "long_term",
  "large_summary",
  "small_summary",
  "private",
  "trash"
]);

function normalizeSection(value, fallback = "long_term") {
  const section = String(value || "").trim();
  return ALL_SECTIONS.has(section) ? section : fallback;
}

function sectionToStatus(section) {
  // The current Supabase table still has the old status check constraint
  // (`pending|approved|edited|rejected`). To avoid a risky schema migration,
  // private and trash records are stored as `rejected`, while the real section
  // lives in metadata.independentSection.
  return READABLE_SECTIONS.has(section) ? "approved" : "rejected";
}

function getMetadata(entry) {
  return entry && entry.metadata && typeof entry.metadata === "object"
    ? entry.metadata
    : {};
}

function inferLegacySection(entry) {
  const metadata = getMetadata(entry);
  if (metadata.independentSection) {
    return normalizeSection(metadata.independentSection);
  }

  if (entry.status === "rejected") {
    return "trash";
  }

  if (entry.status === "pending") {
    return "small_summary";
  }

  if (
    metadata.memoryKind === "current_summary" ||
    metadata.timeScope === "current" ||
    metadata.retention === "rolling"
  ) {
    return "large_summary";
  }

  return "long_term";
}

function normalizeRecord(entry) {
  const metadata = getMetadata(entry);
  const section = inferLegacySection(entry);
  return {
    id: entry.id,
    section,
    title:
      typeof metadata.independentTitle === "string" && metadata.independentTitle.trim()
        ? metadata.independentTitle.trim()
        : section === "long_term"
          ? "长期记忆"
          : section === "large_summary"
            ? "大总结"
            : section === "small_summary"
              ? "小总结"
              : section === "private"
                ? "私密记忆"
                : "垃圾箱记忆",
    content: entry.summary || "",
    detail: entry.detail || "",
    sourceChannel: entry.source_channel || "",
    sourceRef: entry.source_ref || "",
    status: entry.status || "",
    createdAt: entry.created_at || "",
    updatedAt: entry.updated_at || "",
    trashedAt: metadata.trashedAt || "",
    modelReadable: READABLE_SECTIONS.has(section),
    metadata: {
      ...metadata,
      independentSection: section
    }
  };
}

function groupRecords(records) {
  const sections = {
    long_term: [],
    large_summary: [],
    small_summary: [],
    private: [],
    trash: []
  };

  for (const record of records) {
    sections[record.section].push(record);
  }

  return sections;
}

function createFingerprint(section, content) {
  const seed = [
    "independent-memory",
    section,
    Date.now(),
    Math.random().toString(16).slice(2),
    content.slice(0, 80)
  ].join(":");
  return seed.replace(/\s+/g, "-").slice(0, 180);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeTitle(value, section) {
  const fallback = {
    long_term: "长期记忆",
    large_summary: "大总结",
    small_summary: "小总结",
    private: "私密记忆",
    trash: "垃圾箱记忆"
  }[section];
  return String(value || fallback).trim().slice(0, 80);
}

async function readAllIndependentMemory(config) {
  const [entries, sharedMemory] = await Promise.all([
    listMemoryEntries(config, {
      statuses: ["pending", "approved", "edited", "rejected"]
    }),
    getSharedMemory(config)
  ]);

  const records = entries.map(normalizeRecord);

  if (sharedMemory.content && sharedMemory.content.trim()) {
    records.push({
      id: "shared-memory-primary",
      section: "long_term",
      title: "旧手动共享记忆",
      content: sharedMemory.content,
      detail: "",
      sourceChannel: "legacy_shared_memory",
      sourceRef: "primary",
      status: "approved",
      createdAt: sharedMemory.updatedAt || "",
      updatedAt: sharedMemory.updatedAt || "",
      trashedAt: "",
      modelReadable: true,
      virtual: true,
      metadata: {
        independentSection: "long_term",
        legacySharedMemory: true
      }
    });
  }

  return {
    records,
    sections: groupRecords(records)
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, PATCH, DELETE, OPTIONS"
    }
  });
}

export async function GET(request) {
  const config = readConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return json(503, {
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    });
  }

  const auth = await authorizeRequest(request, config);
  if (!auth || auth.kind !== "user") {
    return json(401, {
      error: "Unauthorized"
    });
  }

  try {
    const result = await readAllIndependentMemory(config);
    return json(200, result);
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}

export async function POST(request) {
  const config = readConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return json(503, {
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    });
  }

  const auth = await authorizeRequest(request, config);
  if (!auth || auth.kind !== "user") {
    return json(401, {
      error: "Unauthorized"
    });
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const section = normalizeSection(payload && payload.section);
  const content = normalizeText(payload && payload.content);
  if (!content) {
    return json(400, {
      error: "Memory content cannot be empty."
    });
  }

  const title = normalizeTitle(payload && payload.title, section);
  const now = new Date().toISOString();
  const metadata = {
    ...(payload && payload.metadata && typeof payload.metadata === "object"
      ? payload.metadata
      : {}),
    independentMemoryVersion: 1,
    independentSection: section,
    independentTitle: title,
    trashedAt: section === "trash" ? now : ""
  };

  try {
    const entries = await upsertMemoryEntries(
      config,
      [
        {
          fingerprint: createFingerprint(section, content),
          source_channel: "web_independent_memory",
          source_ref: section,
          summary: content,
          detail: "",
          reason: "Created from the independent memory web page.",
          confidence: null,
          status: sectionToStatus(section),
          metadata
        }
      ],
      auth.userId
    );
    return json(200, {
      record: entries[0] ? normalizeRecord(entries[0]) : null
    });
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}

export async function PATCH(request) {
  const config = readConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return json(503, {
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    });
  }

  const auth = await authorizeRequest(request, config);
  if (!auth || auth.kind !== "user") {
    return json(401, {
      error: "Unauthorized"
    });
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const id = String(payload && payload.id || "").trim();
  if (!id) {
    return json(400, {
      error: "Body must include a memory id."
    });
  }

  const content = normalizeText(payload && payload.content);
  if (!content) {
    return json(400, {
      error: "Memory content cannot be empty."
    });
  }

  if (id === "shared-memory-primary") {
    const saved = await putSharedMemory(config, content, auth.userId);
    return json(200, {
      record: {
        id,
        section: "long_term",
        title: "旧手动共享记忆",
        content: saved.content,
        updatedAt: saved.updatedAt,
        modelReadable: true,
        virtual: true
      }
    });
  }

  const section = normalizeSection(payload && payload.section);
  const title = normalizeTitle(payload && payload.title, section);
  const existingMetadata =
    payload && payload.metadata && typeof payload.metadata === "object"
      ? payload.metadata
      : {};
  const metadata = {
    ...existingMetadata,
    independentMemoryVersion: 1,
    independentSection: section,
    independentTitle: title,
    trashedAt:
      section === "trash"
        ? existingMetadata.trashedAt || new Date().toISOString()
        : ""
  };

  try {
    const entry = await patchMemoryEntry(
      config,
      id,
      {
        summary: content,
        status: sectionToStatus(section),
        metadata
      },
      auth.userId
    );
    return json(200, {
      record: entry ? normalizeRecord(entry) : null
    });
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}

export async function DELETE(request) {
  const config = readConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return json(503, {
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    });
  }

  const auth = await authorizeRequest(request, config);
  if (!auth || auth.kind !== "user") {
    return json(401, {
      error: "Unauthorized"
    });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!id || id === "shared-memory-primary") {
    return json(400, {
      error: "This memory cannot be permanently deleted here."
    });
  }

  try {
    await deleteMemoryEntry(config, id);
    return json(200, {
      ok: true,
      deletedId: id
    });
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}
