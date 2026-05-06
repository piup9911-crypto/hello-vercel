import {
  authorizeRequest,
  callSupabase,
  json,
  readConfig,
  SHARED_MEMORY_TABLE
} from "./_memory-shared.mjs";

const CODEX_CONTROL_KEY = "codex_control";
const ALLOWED_ACTIONS = new Map([
  ["start_codex_bridge", "启动祈桥接"],
  ["restart_codex_bridge", "重启祈桥接"],
  ["sync_codex_status", "同步 Codex 状态"],
  ["start_ccgram", "启动 CCGram"],
  ["restart_ccgram", "重启 CCGram"],
  ["sync_ccgram_status", "同步 Codex 状态"]
]);

function emptyState() {
  return {
    schemaVersion: 1,
    command: null,
    history: []
  };
}

function safeHistory(history) {
  return Array.isArray(history) ? history.slice(-20) : [];
}

function createCommand(action, userId) {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    label: ALLOWED_ACTIONS.get(action),
    status: "queued",
    requestedAt: now,
    requestedBy: userId || null,
    updatedAt: now,
    message: "已加入队列，等待本机控制器领取。"
  };
}

async function readControlState(config) {
  const rows = await callSupabase(
    config,
    `/rest/v1/${SHARED_MEMORY_TABLE}?memory_key=eq.${encodeURIComponent(
      CODEX_CONTROL_KEY
    )}&select=content,updated_at`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row.content !== "string" || !row.content.trim()) {
    return emptyState();
  }

  try {
    const parsed = JSON.parse(row.content);
    return {
      schemaVersion: 1,
      command: parsed && parsed.command ? parsed.command : null,
      history: safeHistory(parsed && parsed.history),
      storedAt: row.updated_at || null
    };
  } catch {
    return emptyState();
  }
}

async function writeControlState(config, state, userId) {
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
          memory_key: CODEX_CONTROL_KEY,
          content: JSON.stringify({
            schemaVersion: 1,
            command: state.command || null,
            history: safeHistory(state.history)
          }),
          updated_by: userId || null
        }
      ])
    }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    schemaVersion: 1,
    command: state.command || null,
    history: safeHistory(state.history),
    storedAt: row && row.updated_at ? row.updated_at : null
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, PUT, OPTIONS"
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
    const state = await readControlState(config);
    return json(200, {
      ...state,
      allowedActions: Array.from(ALLOWED_ACTIONS, ([id, label]) => ({ id, label }))
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

  const action = payload && typeof payload.action === "string" ? payload.action : "";
  if (!ALLOWED_ACTIONS.has(action)) {
    return json(400, {
      error: "Unsupported action"
    });
  }

  try {
    const state = await readControlState(config);
    const previous = state.command ? [state.command, ...safeHistory(state.history)] : safeHistory(state.history);
    const command = createCommand(action, auth.userId);
    return json(
      200,
      await writeControlState(
        config,
        {
          command,
          history: previous
        },
        auth.userId
      )
    );
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

  if (auth.kind !== "sync") {
    return json(403, {
      error: "Only the local sync agent can update command status"
    });
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  try {
    const state = await readControlState(config);
    const command = state.command;
    if (!command || !payload || payload.id !== command.id) {
      return json(409, {
        error: "Command no longer matches current state"
      });
    }

    const now = new Date().toISOString();
    const nextCommand = {
      ...command,
      status: typeof payload.status === "string" ? payload.status : command.status,
      message: typeof payload.message === "string" ? payload.message.slice(0, 1200) : command.message,
      updatedAt: now,
      claimedAt: payload.status === "running" && !command.claimedAt ? now : command.claimedAt || null,
      completedAt:
        ["completed", "failed", "skipped"].includes(payload.status) && !command.completedAt
          ? now
          : command.completedAt || null
    };

    return json(
      200,
      await writeControlState(
        config,
        {
          command: nextCommand,
          history: state.history
        },
        null
      )
    );
  } catch (error) {
    return json(500, {
      error: error && error.message ? error.message : String(error)
    });
  }
}
