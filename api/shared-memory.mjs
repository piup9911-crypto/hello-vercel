import {
  authorizeRequest,
  getSharedMemory,
  json,
  listMemoryEntries,
  putSharedMemory,
  readConfig
} from "./_memory-shared.mjs";

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
    const approvedEntries = (await listMemoryEntries(config, {
      statuses: ["approved", "edited"]
    })).filter((entry) => {
      const metadata =
        entry && entry.metadata && typeof entry.metadata === "object"
          ? entry.metadata
          : {};
      const section = metadata.independentSection || "";
      // The independent memory page stores private/trash records in the same
      // legacy table for now. Keep this old shared-memory endpoint model-readable
      // by excluding sections that should never be sent to agents.
      return section !== "private" && section !== "trash";
    });
    const pendingEntries =
      auth.kind === "user"
        ? await listMemoryEntries(config, { status: "pending" })
        : [];
    return json(200, {
      content: memory.content,
      updatedAt: memory.updatedAt,
      approvedEntries,
      pendingEntries
    });
  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    
    try {
      const proto = request.headers.get('x-forwarded-proto') || 'http';
      const host = request.headers.get('host');
      if (host) {
        await fetch(`${proto}://${host}/api/error-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'api',
            api: '/api/shared-memory',
            level: 'error',
            message: errorMessage,
            stackSummary: error && error.stack ? error.stack : null,
            status: 500
          })
        }).catch(() => {});
      }
    } catch (e) {}

    return json(500, {
      error: errorMessage
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
    const errorMessage = error && error.message ? error.message : String(error);
    
    try {
      const proto = request.headers.get('x-forwarded-proto') || 'http';
      const host = request.headers.get('host');
      if (host) {
        await fetch(`${proto}://${host}/api/error-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'api',
            api: '/api/shared-memory',
            level: 'error',
            message: errorMessage,
            stackSummary: error && error.stack ? error.stack : null,
            status: 500
          })
        }).catch(() => {});
      }
    } catch (e) {}

    return json(500, {
      error: errorMessage
    });
  }
}
