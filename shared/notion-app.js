(function () {
  const ACTIVE_ID_KEY = "mini-notion-active-cloud-id";
  const LEGACY_NOTES_KEY = "mini-notion-notes";
  const LEGACY_DOC_PREFIX = "mini-notion-doc-";
  const BACKUP_VERSION = 2;
  const NOTE_TABLE = "mini_notion_notes";

  const titleInput = document.getElementById("page-title");
  const iconDiv = document.getElementById("page-icon");
  const statusDiv = document.getElementById("save-status");
  const noteListDiv = document.getElementById("note-list");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFileInput = document.getElementById("import-file-input");
  const migrateBtn = document.getElementById("migrate-btn");
  const signoutBtn = document.getElementById("signout-btn");
  const sidebar = document.getElementById("sidebar");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const mobileOverlay = document.getElementById("mobile-overlay");
  const cloudStatus = document.getElementById("cloud-status");
  const authEmail = document.getElementById("auth-email");
  const mainScrollArea = document.getElementById("main-scroll-area");
  const newNoteBtn = document.getElementById("new-note-btn");
  const blockButtons = Array.from(document.querySelectorAll("[data-block-type]"));

  const emojis = [
    "📄",
    "📝",
    "🚀",
    "💡",
    "🌟",
    "🦄",
    "🎯",
    "🎨",
    "📚",
    "☕",
    "🎮",
    "🪴",
    "🐱",
    "🎸",
    "🍔",
    "🌈",
    "🔥",
    "📅",
    "🎉",
    "🏖️",
  ];

  let supabase = null;
  let currentUser = null;
  let notes = [];
  let activeNoteId = localStorage.getItem(ACTIVE_ID_KEY);
  let editor = null;
  let statusTimer = null;
  const pendingSyncTimers = new Map();

  function safeParseJSON(value, fallback) {
    if (!value) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      console.warn("JSON 解析失败，已回退默认值。", error);
      return fallback;
    }
  }

  function showSaveStatus(message) {
    clearTimeout(statusTimer);
    statusDiv.textContent = message;
    statusDiv.classList.add("show");
    statusTimer = window.setTimeout(() => {
      statusDiv.classList.remove("show");
    }, 2000);
  }

  function saveUiState() {
    if (activeNoteId) {
      localStorage.setItem(ACTIVE_ID_KEY, activeNoteId);
    } else {
      localStorage.removeItem(ACTIVE_ID_KEY);
    }
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function openSidebar() {
    if (!isMobileViewport()) {
      return;
    }

    sidebar.classList.add("open");
    mobileOverlay.classList.add("show");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    mobileOverlay.classList.remove("show");
  }

  function getNoteById(noteId) {
    return notes.find((note) => note.id === noteId) || null;
  }

  function readStoredDoc(noteId) {
    const note = getNoteById(noteId);
    return note && note.doc && typeof note.doc === "object" ? note.doc : {};
  }

  function normalizeCloudNote(row) {
    return {
      createdAt: Date.parse(row.created_at || row.updated_at || new Date().toISOString()),
      doc: row.content && typeof row.content === "object" ? row.content : {},
      icon: row.icon || "📄",
      id: row.id,
      title: row.title || "",
      updatedAt: Date.parse(row.updated_at || row.created_at || new Date().toISOString()),
    };
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    const timeString = `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes(),
    ).padStart(2, "0")}`;

    if (isToday) {
      return `今天 ${timeString}`;
    }

    return `${date.getMonth() + 1}月${date.getDate()}日 ${timeString}`;
  }

  function renderSidebar() {
    noteListDiv.innerHTML = "";

    const sortedNotes = [...notes].sort((left, right) => right.updatedAt - left.updatedAt);

    sortedNotes.forEach((note) => {
      const wrapper = document.createElement("div");
      wrapper.className = `note-item ${note.id === activeNoteId ? "active" : ""}`;
      wrapper.addEventListener("click", () => {
        void switchNote(note.id);
      });

      const header = document.createElement("div");
      header.className = "note-item-header";

      const iconSpan = document.createElement("span");
      iconSpan.textContent = note.icon || "📄";

      const titleSpan = document.createElement("span");
      titleSpan.textContent = note.title.trim() || "无标题笔记";

      header.appendChild(iconSpan);
      header.appendChild(titleSpan);

      const timeDiv = document.createElement("div");
      timeDiv.className = "note-item-time";
      timeDiv.textContent = `编辑于 ${formatDate(note.updatedAt)}`;

      wrapper.appendChild(header);
      wrapper.appendChild(timeDiv);

      if (notes.length > 1) {
        const deleteBtn = document.createElement("div");
        deleteBtn.className = "delete-btn";
        deleteBtn.title = "删除文档";
        deleteBtn.textContent = "🗑️";
        deleteBtn.addEventListener("click", (event) => {
          void deleteNote(event, note.id);
        });
        wrapper.appendChild(deleteBtn);
      }

      noteListDiv.appendChild(wrapper);
    });
  }

  async function loadNotesFromCloud() {
    const { data, error } = await supabase
      .from(NOTE_TABLE)
      .select("id, title, icon, content, created_at, updated_at")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    notes = (data || []).map(normalizeCloudNote);
  }

  async function syncNoteToCloud(noteId, statusMessage) {
    const note = getNoteById(noteId);

    if (!note) {
      return;
    }

    const { data, error } = await supabase
      .from(NOTE_TABLE)
      .update({
        content: note.doc || {},
        icon: note.icon || "📄",
        title: note.title || "",
        updated_at: new Date(note.updatedAt).toISOString(),
      })
      .eq("id", noteId)
      .eq("user_id", currentUser.id)
      .select("id, title, icon, content, created_at, updated_at")
      .single();

    if (error) {
      throw error;
    }

    const nextNote = normalizeCloudNote(data);
    const index = notes.findIndex((item) => item.id === noteId);

    if (index >= 0) {
      notes[index] = nextNote;
    }

    if (activeNoteId === noteId) {
      updatedDomFromActiveNote();
    }

    renderSidebar();

    if (statusMessage) {
      showSaveStatus(statusMessage);
    }
  }

  function scheduleNoteSync(noteId, statusMessage) {
    if (pendingSyncTimers.has(noteId)) {
      window.clearTimeout(pendingSyncTimers.get(noteId));
    }

    const timerId = window.setTimeout(async () => {
      pendingSyncTimers.delete(noteId);

      try {
        await syncNoteToCloud(noteId, statusMessage || "☁️ 已同步到云端");
      } catch (error) {
        console.error("Mini Notion 云端同步失败：", error);
        showSaveStatus(`⚠️ ${window.AppAuth.humanizeError(error)}`);
      }
    }, 600);

    pendingSyncTimers.set(noteId, timerId);
  }

  async function flushPendingSync(noteId, statusMessage) {
    if (!pendingSyncTimers.has(noteId)) {
      return;
    }

    window.clearTimeout(pendingSyncTimers.get(noteId));
    pendingSyncTimers.delete(noteId);

    try {
      await syncNoteToCloud(noteId, statusMessage || "");
    } catch (error) {
      console.error("Mini Notion 云端同步失败：", error);
      showSaveStatus(`⚠️ ${window.AppAuth.humanizeError(error)}`);
    }
  }

  async function captureEditorState(noteId) {
    if (!editor || !noteId) {
      return;
    }

    try {
      const outputData = await editor.save();
      const note = getNoteById(noteId);

      if (note) {
        note.doc = outputData;
      }
    } catch (error) {
      console.warn("Editor.js 当前内容读取失败。", error);
    }
  }

  function updatedDomFromActiveNote() {
    const activeNote = getNoteById(activeNoteId);

    if (!activeNote) {
      return;
    }

    titleInput.value = activeNote.title;
    iconDiv.textContent = activeNote.icon || "📄";
  }

  async function destroyEditorInstance() {
    if (!editor) {
      return;
    }

    const currentEditor = editor;
    editor = null;

    try {
      if (currentEditor.isReady && typeof currentEditor.isReady.then === "function") {
        await currentEditor.isReady;
      }
    } catch (error) {
      console.warn("Editor.js 实例还没完全准备好，继续尝试清理。", error);
    }

    if (typeof currentEditor.destroy === "function") {
      currentEditor.destroy();
    }
  }

  async function initEditor(data, noteId) {
    await destroyEditorInstance();

    const editorNoteId = noteId;

    editor = new EditorJS({
      data,
      holder: "editorjs",
      i18n: {
        messages: {
          blockTunes: {
            delete: { Delete: "删除该模块" },
            moveDown: { "Move down": "向下移动" },
            moveUp: { "Move up": "向上移动" },
          },
          toolNames: {
            Bold: "加粗",
            Checklist: "待办清单",
            Heading: "大标题",
            Italic: "斜体",
            Link: "插入链接",
            List: "圆点列表",
            Marker: "高亮标记",
            Quote: "引用片段",
            Text: "正文笔记",
          },
          ui: {
            blockTunes: {
              toggler: {
                "Click to tune": "模块设置",
                "or drag to move": "(拖拽可移动)",
              },
            },
            inlineToolbar: { converter: { "Convert to": "转换为" } },
            toolbar: { toolbox: { Add: "添加组件" } },
          },
        },
      },
      onChange: async () => {
        try {
          const outputData = await editor.save();
          const note = getNoteById(editorNoteId);

          if (!note) {
            return;
          }

          note.doc = outputData;
          note.updatedAt = Date.now();
          saveUiState();
          renderSidebar();
          scheduleNoteSync(editorNoteId, "☁️ 已同步到云端");
        } catch (error) {
          console.error("Editor.js 内容保存失败：", error);
        }
      },
      placeholder: "在这里开始输入正文笔记... (选中文字可加粗/高亮)",
      tools: {
        checklist: { class: Checklist, inlineToolbar: true },
        header: {
          class: Header,
          config: {
            defaultLevel: 2,
            levels: [1, 2, 3],
            placeholder: "输入标题",
          },
          inlineToolbar: true,
        },
        list: { class: EditorjsList, inlineToolbar: true },
        marker: { class: Marker, shortcut: "CMD+SHIFT+M" },
        quote: { class: Quote, inlineToolbar: true },
      },
    });
  }

  async function switchNote(noteId, options) {
    const settings = options || {};
    const nextNote = getNoteById(noteId) || notes[0] || null;

    if (!nextNote) {
      return;
    }

    if (editor && activeNoteId === nextNote.id && !settings.forceReload) {
      if (isMobileViewport()) {
        closeSidebar();
      }
      return;
    }

    if (!settings.skipFlush && activeNoteId) {
      await captureEditorState(activeNoteId);
      await flushPendingSync(activeNoteId, "");
    }

    activeNoteId = nextNote.id;
    saveUiState();
    updatedDomFromActiveNote();
    renderSidebar();
    await initEditor(nextNote.doc || {}, nextNote.id);

    if (isMobileViewport()) {
      closeSidebar();
    }
  }

  async function createNewNote(options) {
    const settings = options || {};

    if (activeNoteId) {
      await captureEditorState(activeNoteId);
      await flushPendingSync(activeNoteId, "");
    }

    const { data, error } = await supabase
      .from(NOTE_TABLE)
      .insert({
        content: {},
        icon: "📄",
        title: "",
        user_id: currentUser.id,
      })
      .select("id, title, icon, content, created_at, updated_at")
      .single();

    if (error) {
      throw error;
    }

    const createdNote = normalizeCloudNote(data);
    notes.unshift(createdNote);
    activeNoteId = createdNote.id;
    saveUiState();
    renderSidebar();
    await switchNote(createdNote.id, { skipFlush: true });

    if (settings.focus !== false) {
      titleInput.focus();
    }

    showSaveStatus(settings.statusMessage || "☁️ 已创建一篇新的云端文档");
  }

  async function deleteNote(event, noteId) {
    event.stopPropagation();

    const note = getNoteById(noteId);

    if (!note) {
      return;
    }

    const confirmed = window.confirm(`确定要彻底删除《${note.title.trim() || "无标题笔记"}》吗？`);

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from(NOTE_TABLE)
      .delete()
      .eq("id", noteId)
      .eq("user_id", currentUser.id);

    if (error) {
      console.error("删除云端笔记失败：", error);
      showSaveStatus(`⚠️ ${window.AppAuth.humanizeError(error)}`);
      return;
    }

    if (pendingSyncTimers.has(noteId)) {
      window.clearTimeout(pendingSyncTimers.get(noteId));
      pendingSyncTimers.delete(noteId);
    }

    notes = notes.filter((noteItem) => noteItem.id !== noteId);

    if (!notes.length) {
      await createNewNote({
        focus: true,
        statusMessage: "☁️ 最后一篇删掉后，已经为你补了一篇新的空白文档",
      });
      return;
    }

    if (activeNoteId === noteId) {
      await switchNote(notes[0].id, { skipFlush: true });
    } else {
      renderSidebar();
    }

    showSaveStatus("☁️ 这篇笔记已经从云端删除");
  }

  function buildBackupPayload() {
    return {
      exportedAt: new Date().toISOString(),
      notes: notes
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((note) => ({
          createdAt: note.createdAt,
          icon: note.icon,
          id: note.id,
          title: note.title,
          updatedAt: note.updatedAt,
        })),
      docs: notes.reduce((accumulator, note) => {
        accumulator[note.id] = note.doc || {};
        return accumulator;
      }, {}),
      source: "mini-notion-cloud",
      version: BACKUP_VERSION,
    };
  }

  function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function exportBackup() {
    if (activeNoteId) {
      await captureEditorState(activeNoteId);
      await flushPendingSync(activeNoteId, "");
    }

    const backup = buildBackupPayload();
    const dateLabel = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `mini-notion-backup-${dateLabel}.json`,
      JSON.stringify(backup, null, 2),
      "application/json;charset=utf-8",
    );
    showSaveStatus("⬇️ 已导出 Mini Notion 云端备份");
  }

  function readLegacyBackupPayload() {
    const legacyNotes = safeParseJSON(localStorage.getItem(LEGACY_NOTES_KEY), []);

    if (!Array.isArray(legacyNotes) || !legacyNotes.length) {
      return null;
    }

    const docs = {};
    legacyNotes.forEach((note) => {
      docs[note.id] = safeParseJSON(localStorage.getItem(`${LEGACY_DOC_PREFIX}${note.id}`), {});
    });

    return {
      docs,
      notes: legacyNotes,
      source: "mini-notion-local",
      version: 1,
    };
  }

  function hasLegacyLocalData() {
    return Boolean(readLegacyBackupPayload());
  }

  function toIsoTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }

    if (typeof value === "string" && value) {
      const asDate = Date.parse(value);
      if (Number.isFinite(asDate)) {
        return new Date(asDate).toISOString();
      }
    }

    return new Date().toISOString();
  }

  function normalizeImportedBackup(rawBackup) {
    if (!rawBackup || !Array.isArray(rawBackup.notes)) {
      return null;
    }

    return rawBackup.notes.map((rawNote) => {
      const rawDocs = rawBackup.docs && typeof rawBackup.docs === "object" ? rawBackup.docs : {};
      const doc = rawDocs[rawNote.id];

      return {
        content: doc && typeof doc === "object" ? doc : {},
        created_at: toIsoTimestamp(rawNote.createdAt || rawNote.updatedAt),
        icon: typeof rawNote.icon === "string" && rawNote.icon ? rawNote.icon : "📄",
        title: typeof rawNote.title === "string" ? rawNote.title : "",
        updated_at: toIsoTimestamp(rawNote.updatedAt || rawNote.createdAt),
        user_id: currentUser.id,
      };
    });
  }

  async function replaceCloudNotesFromBackup(rawBackup, sourceLabel) {
    const normalizedNotes = normalizeImportedBackup(rawBackup);

    if (!normalizedNotes) {
      window.alert("这个文件不是可识别的 Mini Notion 备份。");
      return;
    }

    const confirmed = window.confirm(
      `${sourceLabel}会覆盖云端里当前账号的全部 Mini Notion 内容。建议你先导出一份云端备份。确定继续吗？`,
    );

    if (!confirmed) {
      return;
    }

    await destroyEditorInstance();

    const { error: deleteError } = await supabase
      .from(NOTE_TABLE)
      .delete()
      .eq("user_id", currentUser.id);

    if (deleteError) {
      throw deleteError;
    }

    let insertedRows = [];

    if (normalizedNotes.length) {
      const { data, error } = await supabase
        .from(NOTE_TABLE)
        .insert(normalizedNotes)
        .select("id, title, icon, content, created_at, updated_at");

      if (error) {
        throw error;
      }

      insertedRows = data || [];
    }

    notes = insertedRows.map(normalizeCloudNote);

    if (!notes.length) {
      await createNewNote({
        focus: true,
        statusMessage: "☁️ 云端内容已清空，并为你补了一篇新的空白文档",
      });
      return;
    }

    notes.sort((left, right) => right.updatedAt - left.updatedAt);
    activeNoteId = notes[0].id;
    saveUiState();
    renderSidebar();
    await switchNote(activeNoteId, { skipFlush: true });
    showSaveStatus(`☁️ ${sourceLabel}已经导入到云端`);
  }

  async function importBackupFile(file) {
    const rawText = await file.text();
    const parsed = safeParseJSON(rawText, null);
    await replaceCloudNotesFromBackup(parsed, "JSON 备份");
  }

  async function migrateLegacyLocalData() {
    const legacyBackup = readLegacyBackupPayload();

    if (!legacyBackup) {
      window.alert("当前浏览器里没有找到旧版 Mini Notion 本地数据。");
      return;
    }

    await replaceCloudNotesFromBackup(legacyBackup, "本地旧数据迁移");
  }

  async function handleSignOut() {
    if (activeNoteId) {
      await captureEditorState(activeNoteId);
      await flushPendingSync(activeNoteId, "");
    }

    await window.AppAuth.signOut();
    window.location.href = window.AppAuth.getLoginUrl("/notion.html");
  }

  function pickRandomEmoji() {
    return emojis[Math.floor(Math.random() * emojis.length)];
  }

  function addBlock(type) {
    if (!editor) {
      return;
    }

    let data = {};

    if (type === "header") {
      data = { level: 2, text: "" };
    } else if (type === "checklist") {
      data = { items: [{ checked: false, text: "" }] };
    } else if (type === "list") {
      data = { items: [], style: "unordered" };
    }

    const index = editor.blocks.getBlocksCount();
    editor.blocks.insert(type, data, {}, index, true);

    window.setTimeout(() => {
      editor.caret.setToLastBlock("end");
      mainScrollArea.scrollTo({
        behavior: "smooth",
        top: mainScrollArea.scrollHeight,
      });
    }, 50);
  }

  function bindEvents() {
    newNoteBtn.addEventListener("click", () => {
      void createNewNote();
    });

    titleInput.addEventListener("input", () => {
      const activeNote = getNoteById(activeNoteId);

      if (!activeNote) {
        return;
      }

      activeNote.title = titleInput.value;
      activeNote.updatedAt = Date.now();
      renderSidebar();
      scheduleNoteSync(activeNote.id, "☁️ 标题已经同步到云端");
    });

    iconDiv.addEventListener("click", () => {
      const activeNote = getNoteById(activeNoteId);

      if (!activeNote) {
        return;
      }

      activeNote.icon = pickRandomEmoji();
      activeNote.updatedAt = Date.now();
      iconDiv.textContent = activeNote.icon;
      renderSidebar();
      scheduleNoteSync(activeNote.id, "☁️ 图标已经同步到云端");
    });

    exportBtn.addEventListener("click", () => {
      void exportBackup();
    });

    importBtn.addEventListener("click", () => {
      importFileInput.click();
    });

    importFileInput.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      void importBackupFile(file);
    });

    migrateBtn.addEventListener("click", () => {
      void migrateLegacyLocalData();
    });

    signoutBtn.addEventListener("click", () => {
      void handleSignOut();
    });

    sidebarToggle.addEventListener("click", () => {
      if (sidebar.classList.contains("open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    mobileOverlay.addEventListener("click", closeSidebar);

    window.addEventListener("resize", () => {
      if (!isMobileViewport()) {
        closeSidebar();
      }
    });

    blockButtons.forEach((button) => {
      button.addEventListener("click", () => {
        addBlock(button.dataset.blockType);
      });
    });
  }

  async function ensureInitialCloudNote() {
    if (notes.length) {
      return;
    }

    await createNewNote({
      focus: false,
      statusMessage: "☁️ 云端里还没有文档，已经替你创建好了第一篇",
    });
  }

  async function boot() {
    bindEvents();

    if (!window.AppAuth) {
      throw new Error("Supabase 认证脚本没有成功加载。");
    }

    const authState = await window.AppAuth.requireUser();

    if (!authState || authState.redirected) {
      return;
    }

    supabase = authState.client;
    currentUser = authState.user;
    cloudStatus.textContent = "当前文档会自动同步到 Supabase 云端，仍然可以手动导出 JSON 备份。";
    authEmail.textContent = `当前账号：${currentUser.email || "已登录"}`;
    migrateBtn.hidden = !hasLegacyLocalData();

    await loadNotesFromCloud();
    await ensureInitialCloudNote();

    if (!notes.find((note) => note.id === activeNoteId)) {
      notes.sort((left, right) => right.updatedAt - left.updatedAt);
      activeNoteId = notes[0].id;
    }

    saveUiState();
    renderSidebar();
    await switchNote(activeNoteId, { skipFlush: true });
    showSaveStatus("☁️ Mini Notion 云端连接成功");
  }

  void boot().catch((error) => {
    console.error("Mini Notion 启动失败：", error);
    cloudStatus.textContent = "云端暂时还没有连好，请检查 Supabase 表结构和 Vercel 环境变量。";
    // [BUG-7 FIX] 统一增加 AppAuth 存在性守卫，防止 supabase-auth.js CDN 加载失败时
    // 调用 humanizeError() 抛出 TypeError: Cannot read properties of undefined
    const errorMessage = window.AppAuth
      ? window.AppAuth.humanizeError(error)
      : "请检查 Supabase 配置。";
    authEmail.textContent = errorMessage;
    migrateBtn.hidden = true;
    showSaveStatus("⚠️ 云端暂时不可用");
    window.alert(`Mini Notion 还没有连上 Supabase：${errorMessage}`);
  });
})();
