/**
 * shared/error-reporter.js
 * 
 * 捕捉前端未处理错误，过滤敏感信息后发送至 /api/error-events
 * 用于为非工程用户提供 Bug 现场摘要和一键 Prompt
 */

(function() {
    function sendError(errorData) {
      try {
        // 简单脱敏，防止把 token 之类的关键词意外发到后端
        const sensitiveWords = ['token', 'cookie', 'secret', 'password', 'authorization', 'env'];
        const textToScan = (errorData.message || '') + ' ' + (errorData.stackSummary || '');
        
        if (sensitiveWords.some(w => textToScan.toLowerCase().includes(w))) {
           errorData.message = "Error message redacted due to potential sensitive info";
           errorData.stackSummary = "Stack trace redacted";
        }
  
        fetch('/api/error-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'frontend',
            page: window.location.pathname,
            message: errorData.message,
            stackSummary: errorData.stackSummary,
            file: errorData.file,
            line: errorData.line,
            column: errorData.column,
            userAction: window._lastUserAction || null
          })
        }).catch(() => {});
      } catch(e) {}
    }
  
    window.addEventListener('error', function(event) {
      sendError({
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno,
        stackSummary: event.error ? event.error.stack : null
      });
    });
  
    window.addEventListener('unhandledrejection', function(event) {
      sendError({
        message: event.reason ? event.reason.message || String(event.reason) : 'Unhandled Rejection',
        stackSummary: event.reason ? event.reason.stack : null
      });
    });
  
    // 追踪用户的最后一步交互，方便复现
    document.addEventListener('click', function(e) {
      const target = e.target && e.target.closest
        ? e.target.closest('button,a,[role="button"]')
        : null;
      if (target && target.tagName) {
        let action = `Clicked ${target.tagName}`;
        if (target.id) action += ` #${target.id}`;
        if (target.getAttribute('aria-label')) action += ` ${target.getAttribute('aria-label')}`;
        if (target.textContent) action += ` ${target.textContent.trim().slice(0, 80)}`;
        window._lastUserAction = action.slice(0, 200);
      }
    }, { capture: true, passive: true });
  })();
