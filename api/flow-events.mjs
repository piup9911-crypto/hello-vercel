import {
  callSupabase,
  json,
  readConfig,
  SHARED_MEMORY_TABLE
} from "./_memory-shared.mjs";

const FLOW_EVENTS_KEY = "flow_events";
const MAX_BODY_BYTES = 24 * 1024;
const MAX_EVENTS = 80;
const LIMITS = {
  id: 80,
  createdAt: 80,
  program: 80,
  runId: 120,
  step: 100,
  stepLabel: 120,
  status: 20,
  message: 700,
  file: 500,
  hint: 500,
  impact: 500,
  nextAction: 700,
  moduleHint: 120
};
const VALID_STATUSES = new Set(["started", "ok", "warning", "error"]);
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
  /\.env\b/i,
  /private[_\s-]*memory/i
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
  const status = cleanText(source.status, LIMITS.status).toLowerCase();
  return {
    id: cleanText(source.id, LIMITS.id) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    created_at: createdAt,
    createdAt,
    program: cleanText(source.program, LIMITS.program) || "unknown",
    runId: cleanText(source.run_id || source.runId, LIMITS.runId),
    step: cleanText(source.step, LIMITS.step) || "unknown-step",
    stepLabel: cleanText(source.step_label || source.stepLabel, LIMITS.stepLabel) || "未知步骤",
    status: VALID_STATUSES.has(status) ? status : "warning",
    message: cleanText(source.message, LIMITS.message),
    file: cleanText(source.file, LIMITS.file),
    line: cleanNumber(source.line),
    hint: cleanText(source.hint, LIMITS.hint),
    impact: cleanText(source.impact, LIMITS.impact),
    nextAction: cleanText(source.next_action || source.nextAction, LIMITS.nextAction),
    moduleHint: cleanText(source.module_hint || source.moduleHint, LIMITS.moduleHint)
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
      FLOW_EVENTS_KEY
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
          memory_key: FLOW_EVENTS_KEY,
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

function isAuthorized(request, config) {
  const token = (request.headers.get("x-memory-sync-token") || "").trim();
  return Boolean(config.syncToken && token && token === config.syncToken);
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
  if (!isAuthorized(request, config)) {
    return json(401, { error: "Unauthorized" });
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(413, { error: "Flow event body is too large" });
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    rawBody = "";
  }

  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json(413, { error: "Flow event body is too large" });
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
