import { authorizeRequest, json, readConfig } from "./_memory-shared.mjs";
import { createClient } from "@supabase/supabase-js";

// In-memory fallback for local testing before the Supabase schema is applied
const mockEvents = [];

export async function GET(request) {
  const config = readConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return json(503, { error: "Missing config" });
  }

  // Allow viewing for authenticated users
  const auth = await authorizeRequest(request, config);
  if (!auth) {
    return json(401, { error: "Unauthorized" });
  }

  try {
    const supabase = createClient(config.supabaseUrl, config.serviceRoleKey);
    const { data, error } = await supabase
      .from('error_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
      
    if (error) {
      // Fallback to mock if table doesn't exist yet
      return json(200, { events: mockEvents });
    }
    return json(200, { events: data });
  } catch (err) {
    return json(200, { events: mockEvents });
  }
}

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // 1. Filter sensitive keys at the root payload level
  const sensitiveKeys = ['cookie', 'token', 'authorization', 'secret', 'env', 'password'];
  for (const key of Object.keys(payload)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(s => lowerKey.includes(s))) {
      delete payload[key];
    }
  }

  // 2. Further redact message if it contains sensitive substrings
  let safeMessage = String(payload.message || 'Unknown error').slice(0, 500);
  let safeStack = payload.stackSummary ? String(payload.stackSummary).slice(0, 1500) : null;
  const textToScan = (safeMessage + ' ' + (safeStack || '')).toLowerCase();
  
  if (sensitiveKeys.some(w => textToScan.includes(w))) {
     safeMessage = "Error message redacted due to potential sensitive info";
     safeStack = "Stack trace redacted";
  }

  // 3. Construct the whitelisted event object
  const event = {
    source: String(payload.source || 'unknown').slice(0, 50),
    level: String(payload.level || 'error').slice(0, 20),
    page: payload.page ? String(payload.page).slice(0, 200) : null,
    api: payload.api ? String(payload.api).slice(0, 200) : null,
    route: payload.route ? String(payload.route).slice(0, 200) : null,
    status: payload.status ? Number(payload.status) : null,
    message: safeMessage,
    module_hint: payload.moduleHint ? String(payload.moduleHint).slice(0, 100) : null,
    request_id: payload.requestId ? String(payload.requestId).slice(0, 100) : null,
    user_action: payload.userAction ? String(payload.userAction).slice(0, 200) : null,
    stack_summary: safeStack,
    file: payload.file ? String(payload.file).slice(0, 500) : null,
    line: payload.line ? Number(payload.line) : null,
    column_num: payload.column ? Number(payload.column) : null,
    created_at: new Date().toISOString()
  };

  const config = readConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    const supabase = createClient(config.supabaseUrl, config.serviceRoleKey);
    const { error } = await supabase.from('error_events').insert([event]);
    if (error) {
       // Table might not exist, save to memory mock
       mockEvents.unshift(event);
       if (mockEvents.length > 50) mockEvents.pop();
    }
  } else {
    mockEvents.unshift(event);
    if (mockEvents.length > 50) mockEvents.pop();
  }

  return json(200, { success: true });
}
