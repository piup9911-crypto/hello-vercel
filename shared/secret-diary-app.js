(function () {
  const ACTIVE_KEY = "secret-diary-active-cloud-id-v1";
  const ENTRY_TABLE = "secret_diary_entries";
  const LEGACY_ACTIVE_KEY = "secret-diary-active-id-v1";
  const LEGACY_STORAGE_KEY = "secret-diary-entries-v1";

  const moodOptions = [
    { emoji: "🌙", key: "calm", label: "平静" },
    { emoji: "☀️", key: "happy", label: "开心" },
    { emoji: "🫧", key: "soft", label: "心软" },
    { emoji: "🥺", key: "wronged", label: "委屈" },
    { emoji: "🌧️", key: "anxious", label: "焦虑" },
    { emoji: "🫠", key: "tired", label: "疲惫" },
    { emoji: "🌶️", key: "angry", label: "生气" },
    { emoji: "💗", key: "love", label: "心动" },
  ];

  const memoryModes = {
    private: {
      chipClass: "private",
      helper:
        "这篇只是在云端安安静静留给你自己，不默认拿去做长期记忆结论。",
      label: "只留在这里",
    },
    remember: {
      chipClass: "",
      helper:
        "这篇里可能有值得以后继续记住的偏好、感受或重要线索。",
      label: "值得记住",
    },
    vent: {
      chipClass: "vent",
      helper:
        "这篇更多是在把情绪放下来，不要轻易把它当成长久结论。",
      label: "只是发泄",
    },
  };

  const promptTemplates = [
    "今天最想记住的一瞬间是：",
    "现在最想对自己说的一句话是：",
    "今天让我难受的地方是：",
    "如果有人真正懂我，他应该知道：",
    "我希望明天的自己记得：",
  ];

  const entryList = document.getElementById("entry-list");
  const emptyState = document.getElementById("empty-state");
  const searchInput = document.getElementById("search-input");
  const saveStatus = document.getElementById("save-status");
  const entryTitle = document.getElementById("entry-title");
  const entryBody = document.getElementById("entry-body");
  const createdAt = document.getElementById("created-at");
  const updatedAt = document.getElementById("updated-at");
  const wordCount = document.getElementById("word-count");
  const modeHelp = document.getElementById("mode-help");
  const moodChips = document.getElementById("mood-chips");
  const modeChips = document.getElementById("mode-chips");
  const promptChips = document.getElementById("prompt-chips");
  const exportBtn = document.getElementById("export-btn");
  const deleteBtn = document.getElementById("delete-btn");
  const newEntryBtn = document.getElementById("new-entry-btn");
  const migrateBtn = document.getElementById("migrate-btn");
  const signoutBtn = document.getElementById("signout-btn");
  const cloudStatus = document.getElementById("cloud-status");
  const authEmail = document.getElementById("auth-email");

  let supabase = null;
  let currentUser = null;
  let entries = [];
  let activeId = localStorage.getItem(ACTIVE_KEY);
  let saveTimer = null;
  const pendingSyncTimers = new Map();

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
    }).format(new Date(timestamp));
  }

  function formatDateLong(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "long",
      weekday: "long",
      year: "numeric",
    }).format(new Date(timestamp));
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (tag) => {
      return {
        '"': "&quot;",
        "&": "&amp;",
        "'": "&#39;",
        "<": "&lt;",
        ">": "&gt;",
      }[tag];
    });
  }

  function showSaveStatus(message) {
    window.clearTimeout(saveTimer);
    saveStatus.textContent = message;
    saveStatus.classList.add("show");
    saveTimer = window.setTimeout(() => {
      saveStatus.classList.remove("show");
    }, 1800);
  }

  function saveUiState() {
    if (activeId) {
      localStorage.setItem(ACTIVE_KEY, activeId);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  }

  function sortEntries() {
    entries.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function getActiveEntry() {
    return entries.find((entry) => entry.id === activeId) || entries[0] || null;
  }

  function normalizeEntry(row) {
    return {
      body: row.body || "",
      createdAt: Date.parse(row.created_at || row.updated_at || new Date().toISOString()),
      id: row.id,
      memoryMode: row.memory_mode || "private",
      mood: row.mood || "calm",
      title: row.title || "",
      updatedAt: Date.parse(row.updated_at || row.created_at || new Date().toISOString()),
    };
  }

  function refreshMetaOnly(entry) {
    createdAt.textContent = `创建于 ${formatDateLong(entry.createdAt)}`;
    updatedAt.textContent = `最近修改 ${formatDateLong(entry.updatedAt)}`;
    wordCount.textContent = `${entry.body.trim().length} 字`;
  }

  function renderMoodChips() {
    const current = getActiveEntry();

    moodChips.innerHTML = moodOptions
      .map((mood) => {
        const isActive = current && current.mood === mood.key ? "active" : "";
        return `<button class="mood-chip ${isActive}" data-mood="${mood.key}">${mood.emoji} ${mood.label}</button>`;
      })
      .join("");
  }

  function renderModeChips() {
    const current = getActiveEntry();

    modeChips.innerHTML = Object.entries(memoryModes)
      .map(([key, value]) => {
        const isActive = current && current.memoryMode === key ? "active" : "";
        return `<button class="mode-chip ${isActive}" data-mode="${key}">${value.label}</button>`;
      })
      .join("");

    if (current) {
      modeHelp.textContent = memoryModes[current.memoryMode].helper;
    }
  }

  function renderPromptChips() {
    promptChips.innerHTML = promptTemplates
      .map((item) => {
        return `<button class="prompt-chip" data-template="${escapeHtml(item)}">${escapeHtml(
          item,
        )}</button>`;
      })
      .join("");
  }

  function renderEntryList() {
    const keyword = searchInput.value.trim().toLowerCase();
    sortEntries();

    const filteredEntries = entries.filter((entry) => {
      if (!keyword) {
        return true;
      }

      return `${entry.title} ${entry.body}`.toLowerCase().includes(keyword);
    });

    emptyState.style.display = filteredEntries.length ? "none" : "block";
    entryList.innerHTML = filteredEntries
      .map((entry) => {
        const mood = moodOptions.find((item) => item.key === entry.mood) || moodOptions[0];
        const mode = memoryModes[entry.memoryMode] || memoryModes.private;
        const title = entry.title.trim() || "未命名日记";
        const snippet = entry.body.trim() || "还没开始写，但这页已经替你留好了。";
        const isActive = entry.id === activeId ? "active" : "";

        return `
          <div class="entry-card ${isActive}" data-entry-id="${entry.id}">
            <div class="entry-card-top">
              <div class="entry-title">${escapeHtml(title)}</div>
              <div class="entry-date">${formatDate(entry.updatedAt)}</div>
            </div>
            <div class="entry-meta">
              <div class="mini-chip">${mood.emoji} ${mood.label}</div>
              <div class="mini-chip ${mode.chipClass}">${mode.label}</div>
            </div>
            <div class="entry-snippet">${escapeHtml(snippet).replace(/\n+/g, " ")}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderActiveEntry() {
    const current = getActiveEntry();

    if (!current) {
      return;
    }

    entryTitle.value = current.title;
    entryBody.value = current.body;
    refreshMetaOnly(current);
    renderMoodChips();
    renderModeChips();
    renderEntryList();
  }

  async function loadEntriesFromCloud() {
    const { data, error } = await supabase
      .from(ENTRY_TABLE)
      .select("id, title, body, mood, memory_mode, created_at, updated_at")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    entries = (data || []).map(normalizeEntry);
  }

  async function syncEntryToCloud(entryId, statusMessage) {
    const entry = entries.find((item) => item.id === entryId);

    if (!entry) {
      return;
    }

    const { data, error } = await supabase
      .from(ENTRY_TABLE)
      .update({
        body: entry.body,
        memory_mode: entry.memoryMode,
        mood: entry.mood,
        title: entry.title,
        updated_at: new Date(entry.updatedAt).toISOString(),
      })
      .eq("id", entryId)
      .eq("user_id", currentUser.id)
      .select("id, title, body, mood, memory_mode, created_at, updated_at")
      .single();

    if (error) {
      throw error;
    }

    const nextEntry = normalizeEntry(data);
    const index = entries.findIndex((item) => item.id === entryId);

    if (index >= 0) {
      entries[index] = nextEntry;
    }

    if (activeId === entryId) {
      refreshMetaOnly(nextEntry);
    }

    renderEntryList();

    if (statusMessage) {
      showSaveStatus(statusMessage);
    }
  }

  function scheduleEntrySync(entryId, statusMessage) {
    if (pendingSyncTimers.has(entryId)) {
      window.clearTimeout(pendingSyncTimers.get(entryId));
    }

    const timerId = window.setTimeout(async () => {
      pendingSyncTimers.delete(entryId);

      try {
        await syncEntryToCloud(entryId, statusMessage || "☁️ 已同步到云端");
      } catch (error) {
        console.error("秘密日记云端同步失败：", error);
        showSaveStatus(`⚠️ ${window.AppAuth.humanizeError(error)}`);
      }
    }, 600);

    pendingSyncTimers.set(entryId, timerId);
  }

  async function flushPendingEntrySync(entryId, statusMessage) {
    if (!pendingSyncTimers.has(entryId)) {
      return;
    }

    window.clearTimeout(pendingSyncTimers.get(entryId));
    pendingSyncTimers.delete(entryId);

    try {
      await syncEntryToCloud(entryId, statusMessage || "");
    } catch (error) {
      console.error("秘密日记云端同步失败：", error);
      showSaveStatus(`⚠️ ${window.AppAuth.humanizeError(error)}`);
    }
  }

  async function createCloudEntry(seed, statusMessage) {
    const source = seed || {};
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from(ENTRY_TABLE)
      .insert({
        body: source.body || "",
        created_at: source.created_at || now,
        memory_mode: source.memory_mode || "private",
        mood: source.mood || "calm",
        title: source.title || "",
        updated_at: source.updated_at || now,
        user_id: currentUser.id,
      })
      .select("id, title, body, mood, memory_mode, created_at, updated_at")
      .single();

    if (error) {
      throw error;
    }

    const createdEntry = normalizeEntry(data);
    entries.unshift(createdEntry);
    activeId = createdEntry.id;
    saveUiState();
    renderActiveEntry();
    showSaveStatus(statusMessage || "☁️ 已经替你新建了一篇云端日记");
    return createdEntry;
  }

  async function ensureInitialEntry() {
    if (entries.length) {
      return;
    }

    await createCloudEntry(
      {
        body:
          "这里可以写今天发生的事，也可以只写一句想藏起来的话。\n\n不用整理得很漂亮，也不用急着讲道理。先把真正想说的放下来。",
        memory_mode: "private",
        mood: "soft",
        title: "秘密日记开始了",
      },
      "☁️ 云端里还没有日记，已经帮你准备好了第一篇",
    );
  }

  function updateActiveEntry(patch, message) {
    const current = getActiveEntry();

    if (!current) {
      return;
    }

    Object.assign(current, patch, {
      updatedAt: Date.now(),
    });

    refreshMetaOnly(current);
    renderEntryList();
    renderMoodChips();
    renderModeChips();
    saveUiState();
    scheduleEntrySync(current.id, message || "☁️ 已同步到云端");
  }

  async function addNewEntry() {
    if (activeId) {
      await flushPendingEntrySync(activeId, "");
    }

    await createCloudEntry({}, "☁️ 已经替你新建了一篇云端日记");
    entryTitle.focus();
  }

  async function deleteActiveEntry() {
    if (entries.length <= 1) {
      window.alert("至少留下一篇吧，不然这个小房间会空掉。");
      return;
    }

    const current = getActiveEntry();

    if (!current) {
      return;
    }

    const confirmed = window.confirm(
      `确定要删除《${current.title.trim() || "未命名日记"}》吗？这一步不能撤回。`,
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from(ENTRY_TABLE)
      .delete()
      .eq("id", current.id)
      .eq("user_id", currentUser.id);

    if (error) {
      console.error("删除云端日记失败：", error);
      showSaveStatus(`⚠️ ${window.AppAuth.humanizeError(error)}`);
      return;
    }

    if (pendingSyncTimers.has(current.id)) {
      window.clearTimeout(pendingSyncTimers.get(current.id));
      pendingSyncTimers.delete(current.id);
    }

    entries = entries.filter((entry) => entry.id !== current.id);
    activeId = entries[0] ? entries[0].id : null;
    saveUiState();
    renderActiveEntry();
    showSaveStatus("☁️ 这篇日记已经从云端删除");
  }

  function exportActiveEntry() {
    const current = getActiveEntry();

    if (!current) {
      return;
    }

    const mood = moodOptions.find((item) => item.key === current.mood) || moodOptions[0];
    const mode = memoryModes[current.memoryMode] || memoryModes.private;
    const filename = `${(current.title || "秘密日记")
      .replace(/[\\/:*?"<>|]/g, "-")
      .slice(0, 30) || "秘密日记"}.txt`;
    const content = [
      current.title || "未命名日记",
      "",
      `心情：${mood.emoji} ${mood.label}`,
      `去向：${mode.label}`,
      `创建时间：${formatDateLong(current.createdAt)}`,
      `最近修改：${formatDateLong(current.updatedAt)}`,
      "",
      current.body || "",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showSaveStatus("☁️ 当前这篇日记已经导出");
  }

  function applyPrompt(template) {
    const current = getActiveEntry();

    if (!current) {
      return;
    }

    const prefix = current.body.trim() ? `${current.body.trim()}\n\n` : "";
    entryBody.value = `${prefix}${template}`;
    updateActiveEntry({ body: entryBody.value }, "☁️ 已帮你塞进一个写作提示");
    entryBody.focus();
    entryBody.setSelectionRange(entryBody.value.length, entryBody.value.length);
  }

  function readLegacyEntries() {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("旧版本地秘密日记读取失败。", error);
      return [];
    }
  }

  function hasLegacyEntries() {
    return readLegacyEntries().length > 0;
  }

  function toIsoTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }

    if (typeof value === "string" && value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString();
      }
    }

    return new Date().toISOString();
  }

  function normalizeLegacyEntry(entry) {
    return {
      body: typeof entry.body === "string" ? entry.body : "",
      created_at: toIsoTimestamp(entry.createdAt || entry.updatedAt),
      memory_mode:
        typeof entry.memoryMode === "string" && memoryModes[entry.memoryMode]
          ? entry.memoryMode
          : "private",
      mood:
        typeof entry.mood === "string" && moodOptions.some((item) => item.key === entry.mood)
          ? entry.mood
          : "calm",
      title: typeof entry.title === "string" ? entry.title : "",
      updated_at: toIsoTimestamp(entry.updatedAt || entry.createdAt),
      user_id: currentUser.id,
    };
  }

  async function replaceCloudEntries(rawEntries, sourceLabel) {
    const normalizedEntries = (Array.isArray(rawEntries) ? rawEntries : []).map(normalizeLegacyEntry);

    const confirmed = window.confirm(
      `${sourceLabel}会覆盖云端里当前账号的全部秘密日记内容。建议你先导出当前这篇，或者稍后再补一份整库备份。确定继续吗？`,
    );

    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase
      .from(ENTRY_TABLE)
      .delete()
      .eq("user_id", currentUser.id);

    if (deleteError) {
      throw deleteError;
    }

    let insertedRows = [];

    if (normalizedEntries.length) {
      const { data, error } = await supabase
        .from(ENTRY_TABLE)
        .insert(normalizedEntries)
        .select("id, title, body, mood, memory_mode, created_at, updated_at");

      if (error) {
        throw error;
      }

      insertedRows = data || [];
    }

    entries = insertedRows.map(normalizeEntry);
    sortEntries();

    if (!entries.length) {
      await ensureInitialEntry();
    }

    activeId = entries[0].id;
    saveUiState();
    renderActiveEntry();
    showSaveStatus(`☁️ ${sourceLabel}已经导入到云端`);
  }

  async function migrateLegacyEntries() {
    const legacyEntries = readLegacyEntries();

    if (!legacyEntries.length) {
      window.alert("当前浏览器里没有找到旧版本地日记。");
      return;
    }

    await replaceCloudEntries(legacyEntries, "本地旧日记迁移");
  }

  async function handleSignOut() {
    if (activeId) {
      await flushPendingEntrySync(activeId, "");
    }

    await window.AppAuth.signOut();
    window.location.href = window.AppAuth.getLoginUrl("/secret-diary.html");
  }

  function bindEvents() {
    newEntryBtn.addEventListener("click", () => {
      void addNewEntry();
    });

    deleteBtn.addEventListener("click", () => {
      void deleteActiveEntry();
    });

    exportBtn.addEventListener("click", exportActiveEntry);

    searchInput.addEventListener("input", renderEntryList);

    entryTitle.addEventListener("input", (event) => {
      updateActiveEntry({ title: event.target.value }, "☁️ 标题已经同步到云端");
    });

    entryBody.addEventListener("input", (event) => {
      updateActiveEntry({ body: event.target.value }, "☁️ 日记内容已经同步到云端");
    });

    moodChips.addEventListener("click", (event) => {
      const button = event.target.closest("[data-mood]");

      if (!button) {
        return;
      }

      updateActiveEntry({ mood: button.dataset.mood }, "☁️ 心情标签已经同步到云端");
    });

    modeChips.addEventListener("click", (event) => {
      const button = event.target.closest("[data-mode]");

      if (!button) {
        return;
      }

      updateActiveEntry(
        { memoryMode: button.dataset.mode },
        "☁️ 这篇日记的去向已经同步到云端",
      );
    });

    promptChips.addEventListener("click", (event) => {
      const button = event.target.closest("[data-template]");

      if (!button) {
        return;
      }

      applyPrompt(button.dataset.template);
    });

    entryList.addEventListener("click", (event) => {
      const card = event.target.closest("[data-entry-id]");

      if (!card) {
        return;
      }

      activeId = card.dataset.entryId;
      saveUiState();
      renderActiveEntry();
    });

    migrateBtn.addEventListener("click", () => {
      void migrateLegacyEntries();
    });

    signoutBtn.addEventListener("click", () => {
      void handleSignOut();
    });
  }

  async function boot() {
    bindEvents();
    renderPromptChips();

    if (!window.AppAuth) {
      throw new Error("Supabase 认证脚本没有成功加载。");
    }

    const authState = await window.AppAuth.requireUser();

    if (!authState || authState.redirected) {
      return;
    }

    supabase = authState.client;
    currentUser = authState.user;
    cloudStatus.textContent = "当前版本会自动同步到 Supabase 云端，你仍然可以手动导出单篇日记。";
    authEmail.textContent = `当前账号：${currentUser.email || "已登录"}`;
    migrateBtn.hidden = !hasLegacyEntries();

    await loadEntriesFromCloud();
    await ensureInitialEntry();
    sortEntries();

    if (!entries.find((entry) => entry.id === activeId)) {
      activeId = entries[0].id;
    }

    saveUiState();
    renderActiveEntry();
    showSaveStatus("☁️ 秘密日记云端连接成功");
  }

  void boot().catch((error) => {
    console.error("秘密日记启动失败：", error);
    cloudStatus.textContent = "云端暂时还没有连好，请检查 Supabase 表结构和 Vercel 环境变量。";
    authEmail.textContent = window.AppAuth
      ? window.AppAuth.humanizeError(error)
      : "请检查 Supabase 配置。";
    migrateBtn.hidden = true;
    showSaveStatus("⚠️ 云端暂时不可用");
    window.alert(`秘密日记还没有连上 Supabase：${window.AppAuth.humanizeError(error)}`);
  });
})();
