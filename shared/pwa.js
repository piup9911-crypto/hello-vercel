(() => {
  function applyChatRecordPolish() {
    const isChatRecordManager = window.location.pathname.includes("gem-chat-record-manager") || window.location.pathname.startsWith("/chat-records-live");
    const isChatRecordLanding = window.location.pathname.includes("chat-records.html");

    if (!isChatRecordManager && !isChatRecordLanding) return;

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", "#f7f5ef");

    if (!isChatRecordManager || document.getElementById("chat-record-polish-style")) return;

    const style = document.createElement("style");
    style.id = "chat-record-polish-style";
    style.textContent = `
      :root {
        --bg: #f7f5ef;
        --ink: #2f312d;
        --muted: #74776f;
        --line: #dedbd1;
        --accent: #8fa487;
        --accent-soft: #edf4ea;
        --user-bubble: #efe3eb;
        --shadow: 0 18px 42px rgba(50, 54, 48, 0.10);
      }

      body {
        background:
          radial-gradient(circle at 10% 8%, rgba(255, 255, 255, 0.96), transparent 32%),
          radial-gradient(circle at 88% 82%, rgba(239, 227, 235, 0.68), transparent 28%),
          linear-gradient(150deg, #fffdf8 0%, var(--bg) 55%, #eef4ea 100%) !important;
      }

      .sidebar {
        background: rgba(237, 240, 235, 0.76) !important;
        backdrop-filter: blur(18px);
      }

      .chat-button {
        border-radius: 18px !important;
        background: rgba(255, 255, 255, 0.34) !important;
        transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease, border-color 150ms ease;
      }

      .chat-button:hover,
      .chat-button.active {
        background: #fff !important;
        box-shadow: 0 10px 26px rgba(50, 54, 48, 0.07);
        transform: translateY(-1px);
      }

      .topbar {
        background: rgba(255, 255, 255, 0.78) !important;
        backdrop-filter: blur(18px);
      }

      button,
      .chat-action-button {
        border-radius: 999px !important;
      }

      .bubble {
        border-radius: 20px !important;
        box-shadow: 0 6px 18px rgba(50, 54, 48, 0.07) !important;
      }

      .message.user .bubble {
        border-color: color-mix(in srgb, #d9b8c4 55%, var(--line)) !important;
        background: var(--user-bubble) !important;
      }

      .message.assistant .bubble {
        background: #fff !important;
      }

      .scroll-jump-controls button {
        border-color: rgba(143, 164, 135, 0.45) !important;
        color: #6f8768 !important;
      }
    `;
    document.head.appendChild(style);
  }

  applyChatRecordPolish();

  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
})();
