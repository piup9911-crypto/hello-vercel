import {
  authorizeRequest,
  callSupabase,
  json,
  readConfig,
  SHARED_MEMORY_TABLE
} from "./_memory-shared.mjs";

const GEM_STATUS_KEY = "gem_status";

function normalizeStatus(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    updatedAt: now,
    reporter: source.reporter && typeof source.reporter === "object" ? source.reporter : {},
    services: source.services && typeof source.services === "object" ? source.services : {},
    links: source.links && typeof source.links === "object" ? source.links : {},
    notes: typeof source.notes === "string" ? source.notes.slice(0, 1200) : ""
  };
}

async function readGemStatus(config) {
  const rows = await callSupabase(
    config,
    `/rest/v1/${SHARED_MEMORY_TABLE}?memory_key=eq.${encodeURIComponent(
      GEM_STATUS_KEY
    )}&select=content,updated_at`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row.content !== "string" || !row.content.trim()) {
    return {
      schemaVersion: 1,
      updatedAt: null,
      reporter: {},
      services: {},
      links: {},
      notes: ""
    };
  }

  try {
    const parsed = JSON.parse(row.content);
    return {
      ...parsed,
      storedAt: row.updated_at || null
    };
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: row.updated_at || null,
      reporter: {},
      services: {},
      links: {},
      notes: row.content
    };
  }
}

async function writeGemStatus(config, status, userId) {
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
          memory_key: GEM_STATUS_KEY,
          content: JSON.stringify(status),
          updated_by: userId || null
        }
      ])
    }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    ...status,
    storedAt: row && row.updated_at ? row.updated_at : null
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, PUT, POST, OPTIONS"
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
    return json(200, await readGemStatus(config));
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}

export async function POST(request) {
  return PUT(request);
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

  try {
    const status = normalizeStatus(payload);
    return json(200, await writeGemStatus(config, status, auth.userId));
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}
