(function () {
  const LOGIN_PATH = "/index.html";
  let configPromise = null;
  let clientPromise = null;

  function sanitizeReturnTo(rawValue, fallback) {
    if (!rawValue || typeof rawValue !== "string") {
      return fallback;
    }

    if (!rawValue.startsWith("/")) {
      return fallback;
    }

    if (rawValue.startsWith("//")) {
      return fallback;
    }

    return rawValue;
  }

  function getCurrentReturnTo() {
    return sanitizeReturnTo(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
      "/index.html",
    );
  }

  function getLoginUrl(returnTo) {
    const safeReturnTo = sanitizeReturnTo(returnTo, "/index.html");
    return `${LOGIN_PATH}?returnTo=${encodeURIComponent(safeReturnTo)}`;
  }

  function readReturnTo(defaultPath) {
    const params = new URLSearchParams(window.location.search);
    return sanitizeReturnTo(params.get("returnTo"), defaultPath || "/index.html");
  }

  function humanizeError(error) {
    const message = String(error && error.message ? error.message : error || "");
    const lower = message.toLowerCase();

    if (!message) {
      return "发生了一点未知错误，请稍后再试。";
    }

    if (lower.includes("invalid login credentials")) {
      return "邮箱或密码不对，再检查一下。";
    }

    if (lower.includes("email not confirmed")) {
      return "这个账号还没有完成邮箱验证。";
    }

    if (lower.includes("missing supabase_url") || lower.includes("supabase 未配置")) {
      return "云端参数还没配好，需要先在 Vercel 里设置 SUPABASE_URL 和 SUPABASE_ANON_KEY。";
    }

    if (lower.includes("missing supabase_url or supabase_anon_key")) {
      return "云端参数还没配好，需要先在 Vercel 里设置 SUPABASE_URL 和 SUPABASE_ANON_KEY。";
    }

    if (lower.includes("failed to fetch") || lower.includes("network")) {
      return "网络暂时没有连上云端，请稍后再试。";
    }

    return message;
  }

  async function loadConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/supabase-config", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      }).then(async (response) => {
        let payload = {};

        try {
          payload = await response.json();
        } catch (error) {
          payload = {};
        }

        if (!response.ok || !payload.configured || !payload.url || !payload.anonKey) {
          throw new Error(payload.message || "Supabase 未配置");
        }

        return payload;
      });
    }

    return configPromise;
  }

  async function getClient() {
    if (!clientPromise) {
      clientPromise = loadConfig().then((config) => {
        if (!window.supabase || typeof window.supabase.createClient !== "function") {
          throw new Error("Supabase 浏览器 SDK 没有成功加载。");
        }

        return window.supabase.createClient(config.url, config.anonKey, {
          auth: {
            autoRefreshToken: true,
            detectSessionInUrl: true,
            persistSession: true,
          },
          global: {
            headers: {
              "x-client-info": "hello-vercel-static-web",
            },
          },
        });
      });
    }

    return clientPromise;
  }

  async function getSession() {
    const client = await getClient();
    const result = await client.auth.getSession();

    if (result.error) {
      throw result.error;
    }

    return {
      client,
      session: result.data.session,
      user: result.data.session ? result.data.session.user : null,
    };
  }

  async function requireUser() {
    const authState = await getSession();

    if (!authState.session) {
      window.location.href = getLoginUrl(getCurrentReturnTo());
      return {
        client: authState.client,
        redirected: true,
        session: null,
        user: null,
      };
    }

    return {
      client: authState.client,
      redirected: false,
      session: authState.session,
      user: authState.user,
    };
  }

  async function signInWithPassword(email, password) {
    const client = await getClient();
    return client.auth.signInWithPassword({
      email,
      password,
    });
  }

  async function signOut() {
    const client = await getClient();
    return client.auth.signOut();
  }

  window.AppAuth = {
    getClient,
    getLoginUrl,
    getSession,
    humanizeError,
    readReturnTo,
    requireUser,
    sanitizeReturnTo,
    signInWithPassword,
    signOut,
  };
})();
