import {
  authorizeRequest,
  json,
  listMemoryEntries,
  patchMemoryEntry,
  readConfig,
  upsertMemoryEntries
} from "./_memory-shared.mjs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, PATCH, OPTIONS"
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

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";

  try {
    const entries = await listMemoryEntries(config, {
      status: status || undefined
    });
    return json(200, {
      entries
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

  const auth = await authorizeRequest(request, config);
  if (!auth) {
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

  const entries = Array.isArray(payload && payload.entries)
    ? payload.entries
    : payload
      ? [payload]
      : [];

  try {
    const saved = await upsertMemoryEntries(config, entries, auth.userId);
    return json(200, {
      entries: saved
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

  if (!payload || typeof payload.id !== "string" || !payload.id.trim()) {
    return json(400, {
      error: "Body must include a non-empty id"
    });
  }

  try {
    const entry = await patchMemoryEntry(config, payload.id, payload, auth.userId);
    return json(200, {
      entry
    });
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}
