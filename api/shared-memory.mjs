const TABLE = "agent_shared_memory";
const PRIMARY_KEY = "primary";

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function readConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    syncToken: process.env.MEMORY_SYNC_TOKEN || ""
  };
}

async function callSupabase(config, relativePath, init = {}) {
  const response = await fetch(`${config.supabaseUrl}${relativePath}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: "application/json",
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(
      (parsed && (parsed.error_description || parsed.message || parsed.error)) ||
        text ||
        `Supabase request failed with ${response.status}`
    );
  }

  return parsed;
}

async function readUserFromBearer(request, config) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey || config.serviceRoleKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const user = await response.json();
  return user && user.id ? user : null;
}

async function authorizeRequest(request, config) {
  const syncToken = (request.headers.get("x-memory-sync-token") || "").trim();
  if (config.syncToken && syncToken && syncToken === config.syncToken) {
    return {
      kind: "sync",
      userId: null
    };
  }

  const user = await readUserFromBearer(request, config);
  if (user) {
    return {
      kind: "user",
      userId: user.id
    };
  }

  return null;
}

async function getSharedMemory(config) {
  const rows = await callSupabase(
    config,
    `/rest/v1/${TABLE}?memory_key=eq.${PRIMARY_KEY}&select=memory_key,content,updated_at`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    content: row && typeof row.content === "string" ? row.content : "",
    updatedAt: row && row.updated_at ? row.updated_at : null
  };
}

async function putSharedMemory(config, content, userId) {
  const rows = await callSupabase(
    config,
    `/rest/v1/${TABLE}?on_conflict=memory_key`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify([
        {
          memory_key: PRIMARY_KEY,
          content,
          updated_by: userId || null
        }
      ])
    }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    content: row && typeof row.content === "string" ? row.content : content,
    updatedAt: row && row.updated_at ? row.updated_at : null
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, PUT, OPTIONS"
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
  if (!auth) {
    return json(401, {
      error: "Unauthorized"
    });
  }

  try {
    const memory = await getSharedMemory(config);
    return json(200, {
      content: memory.content,
      updatedAt: memory.updatedAt
    });
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}

export async function PUT(request) {
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

  if (!payload || typeof payload.content !== "string") {
    return json(400, {
      error: "Body must include a string content field"
    });
  }

  try {
    const memory = await putSharedMemory(config, payload.content, auth.userId);
    return json(200, {
      content: memory.content,
      updatedAt: memory.updatedAt
    });
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}
