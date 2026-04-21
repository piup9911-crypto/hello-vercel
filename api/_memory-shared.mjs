export const SHARED_MEMORY_TABLE = "agent_shared_memory";
export const MEMORY_ENTRIES_TABLE = "agent_memory_entries";
export const PRIMARY_MEMORY_KEY = "primary";

export function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export function readConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    syncToken: process.env.MEMORY_SYNC_TOKEN || ""
  };
}

export async function callSupabase(config, relativePath, init = {}) {
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

export async function readUserFromBearer(request, config) {
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

export async function authorizeRequest(request, config) {
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

export async function getSharedMemory(config) {
  const rows = await callSupabase(
    config,
    `/rest/v1/${SHARED_MEMORY_TABLE}?memory_key=eq.${encodeURIComponent(
      PRIMARY_MEMORY_KEY
    )}&select=memory_key,content,updated_at`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    content: row && typeof row.content === "string" ? row.content : "",
    updatedAt: row && row.updated_at ? row.updated_at : null
  };
}

export async function putSharedMemory(config, content, userId) {
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
          memory_key: PRIMARY_MEMORY_KEY,
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

export async function listMemoryEntries(config, options = {}) {
  const clauses = [];
  if (options.status) {
    clauses.push(`status=eq.${encodeURIComponent(options.status)}`);
  } else if (options.statuses && options.statuses.length > 0) {
    clauses.push(
      `status=in.(${options.statuses.map((item) => `"${item}"`).join(",")})`
    );
  }

  const query = clauses.length > 0 ? `&${clauses.join("&")}` : "";
  try {
    const rows = await callSupabase(
      config,
      `/rest/v1/${MEMORY_ENTRIES_TABLE}?select=id,fingerprint,source_channel,source_ref,summary,detail,reason,confidence,status,metadata,created_at,updated_at,reviewed_at&order=updated_at.desc${query}`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message.includes(`Could not find the table 'public.${MEMORY_ENTRIES_TABLE}'`)) {
      return [];
    }
    throw error;
  }
}

export async function upsertMemoryEntries(config, entries, userId) {
  const normalized = (entries || [])
    .filter(Boolean)
    .map((entry) => ({
      fingerprint: entry.fingerprint,
      source_channel: entry.source_channel || "",
      source_ref: entry.source_ref || "",
      summary: entry.summary || "",
      detail: entry.detail || "",
      reason: entry.reason || "",
      confidence:
        typeof entry.confidence === "number" && Number.isFinite(entry.confidence)
          ? entry.confidence
          : null,
      status: entry.status || "pending",
      metadata: entry.metadata || {},
      created_by: userId || null
    }))
    .filter((entry) => entry.fingerprint && entry.summary);

  if (normalized.length === 0) {
    return [];
  }

  const rows = await callSupabase(
    config,
    `/rest/v1/${MEMORY_ENTRIES_TABLE}?on_conflict=fingerprint`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(normalized)
    }
  );

  return Array.isArray(rows) ? rows : [];
}

export async function patchMemoryEntry(config, id, payload, userId) {
  const patch = {};

  if (typeof payload.summary === "string") patch.summary = payload.summary;
  if (typeof payload.detail === "string") patch.detail = payload.detail;
  if (typeof payload.reason === "string") patch.reason = payload.reason;
  if (typeof payload.status === "string") patch.status = payload.status;
  if ("metadata" in payload) patch.metadata = payload.metadata || {};
  if (
    typeof payload.confidence === "number" &&
    Number.isFinite(payload.confidence)
  ) {
    patch.confidence = payload.confidence;
  }

  if (patch.status && patch.status !== "pending") {
    patch.reviewed_at = new Date().toISOString();
    patch.reviewed_by = userId || null;
  }

  const rows = await callSupabase(
    config,
    `/rest/v1/${MEMORY_ENTRIES_TABLE}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(patch)
    }
  );

  return Array.isArray(rows) ? rows[0] || null : null;
}
