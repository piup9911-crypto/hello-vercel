import {
  callSupabase,
  json,
  readConfig,
  SHARED_MEMORY_TABLE
} from "./_memory-shared.mjs";

const ERROR_EVENTS_KEY = "error_events";
const MAX_BODY_BYTES = 20 * 1024;
const MAX_EVENTS = 50;
const LIMITS = {
  id: 80,
  source: 50,
  level: 20,
  page: 200,
  api: 200,
  route: 200,
  message: 500,
  moduleHint: 100,
  requestId: 100,
  userAction: 200,
  stackSummary: 1500,
  file: 500,
  createdAt: 80
};
const SENSITIVE_PATTERNS = [
  /token/i,
  /cookie/i,
  /authorization/i,
  /bearer\s+[a-z0-9._~+/=-]+/i,
  /secret/i,
  /password/i,
  /service[_\s-]*role/i,
  /supabase[_\s-]*service/i,
  /api[_\s-]*key/i,
  /env/i
];

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "[redacted]";
  }
  return text.slice(0, maxLength);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeEvent(source = {}) {
  const createdAt = cleanText(source.created_at || source.createdAt, LIMITS.createdAt) || new Date().toISOString();
  return {
    id: cleanText(source.id, LIMITS.id) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    created_at: createdAt,
    createdAt,
    source: cleanText(source.source, LIMITS.source) || "unknown",
    level: cleanText(source.level || source.severity, LIMITS.level) || "error",
    page: cleanText(source.page || source.pagePath, LIMITS.page),
    api: cleanText(source.api, LIMITS.api),
    route: cleanText(source.route, LIMITS.route),
    status: cleanNumber(source.status),
    message: cleanText(source.message, LIMITS.message) || "Unknown error",
    module_hint: cleanText(source.module_hint || source.moduleHint, LIMITS.moduleHint),
    moduleHint: cleanText(source.module_hint || source.moduleHint, LIMITS.moduleHint),
    request_id: cleanText(source.request_id || source.requestId, LIMITS.requestId),
    requestId: cleanText(source.request_id || source.requestId, LIMITS.requestId),
    user_action: cleanText(source.user_action || source.userAction, LIMITS.userAction),
    userAction: cleanText(source.user_action || source.userAction, LIMITS.userAction),
    stack_summary: cleanText(source.stack_summary || source.stackSummary || source.stack, LIMITS.stackSummary),
    stackSummary: cleanText(source.stack_summary || source.stackSummary || source.stack, LIMITS.stackSummary),
    file: cleanText(source.file, LIMITS.file),
    line: cleanNumber(source.line),
    column: cleanNumber(source.column || source.column_num),
    column_num: cleanNumber(source.column || source.column_num)
  };
}

function normalizeEvents(events) {
  return Array.isArray(events)
    ? events.filter(Boolean).map((event) => normalizeEvent(event)).slice(0, MAX_EVENTS)
    : [];
}

async function readEvents(config) {
  const rows = await callSupabase(
    config,
    `/rest/v1/${SHARED_MEMORY_TABLE}?memory_key=eq.${encodeURIComponent(
      ERROR_EVENTS_KEY
    )}&select=content,updated_at`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row.content !== "string" || !row.content.trim()) {
    return { events: [], updatedAt: null };
  }

  try {
    const parsed = JSON.parse(row.content);
    return {
      events: normalizeEvents(parsed.events),
      updatedAt: row.updated_at || parsed.updatedAt || null
    };
  } catch {
    return { events: [], updatedAt: row.updated_at || null };
  }
}

async function writeEvents(config, events) {
  const payload = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    events: normalizeEvents(events)
  };

  const rows = await callSupabase(
    config,
    `/rest/v1/${SHARED_MEMORY_TABLE}?on_conflict=memory_key`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify([
        {
          memory_key: ERROR_EVENTS_KEY,
          content: JSON.stringify(payload)
        }
      ])
    }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    events: payload.events,
    updatedAt: row && row.updated_at ? row.updated_at : payload.updatedAt
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, OPTIONS"
    }
  });
}

export async function GET() {
  const config = readConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return json(200, {
      configured: false,
      events: [],
      updatedAt: null
    });
  }

  try {
    const result = await readEvents(config);
    return json(200, {
      configured: true,
      ...result
    });
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

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(413, { error: "Error event body is too large" });
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    rawBody = "";
  }

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json(413, { error: "Error event body is too large" });
  }

  let payload = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  try {
    const event = normalizeEvent(payload || {});
    const current = await readEvents(config);
    const saved = await writeEvents(config, [event, ...current.events].slice(0, MAX_EVENTS));
    return json(200, {
      success: true,
      eventId: event.id,
      stored: saved.events.length,
      updatedAt: saved.updatedAt
    });
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}
