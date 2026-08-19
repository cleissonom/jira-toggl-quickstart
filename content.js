"use strict";

(() => {
  if (window.top !== window) {
    return;
  }

  const ROOT_ID = "jira-toggl-quickstart-root";
  const ISSUE_CACHE_TTL_MS = 10 * 60 * 1000;
  const FAILED_CACHE_TTL_MS = 30 * 1000;
  const JIRA_API_VERSIONS = ["3", "2", "latest"];
  const JIRA_ISSUE_FIELDS = [
    "summary",
    "project",
    "issuetype",
    "status",
    "assignee",
    "reporter",
    "priority",
    "parent",
    "labels",
    "components"
  ].join(",");
  const issueCache = new Map();

  const state = {
    issue: null,
    issueSignature: "",
    timerStatus: null,
    busy: false,
    loadingIssue: false,
    issueError: "",
    refreshSequence: 0,
    lastHref: window.location.href
  };

  const ui = createUi();
  const scheduleIssueRefresh = debounce(refreshIssueContext, 250);

  ui.button.addEventListener("click", () => {
    void handleButtonClick();
  });

  const observer = new MutationObserver(() => {
    scheduleIssueRefresh();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.setInterval(() => {
    if (state.lastHref !== window.location.href) {
      state.lastHref = window.location.href;
      scheduleIssueRefresh();
    }
  }, 500);

  window.addEventListener("focus", () => {
    void refreshTimerStatus();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleIssueRefresh();
      void refreshTimerStatus();
    }
  });

  void refreshIssueContext();

  function createUi() {
    document.getElementById(ROOT_ID)?.remove();

    const host = document.createElement("div");
    host.id = ROOT_ID;
    Object.assign(host.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      zIndex: "2147483647",
      display: "none",
      pointerEvents: "none"
    });

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrapper {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
        }
        .message {
          max-width: 360px;
          padding: 9px 12px;
          border-radius: 10px;
          background: #172b4d;
          color: #fff;
          box-shadow: 0 8px 24px rgba(9, 30, 66, 0.25);
          font-size: 13px;
          line-height: 1.35;
          opacity: 0;
          transform: translateY(4px);
          transition: opacity 120ms ease, transform 120ms ease;
          pointer-events: auto;
        }
        .message.visible {
          opacity: 1;
          transform: translateY(0);
        }
        .message.error { background: #ae2a19; }
        .message.success { background: #216e4e; }
        button {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-height: 48px;
          max-width: 420px;
          padding: 9px 16px;
          border: 0;
          border-radius: 999px;
          background: #0c66e4;
          color: #fff;
          box-shadow: 0 8px 24px rgba(9, 30, 66, 0.28);
          cursor: pointer;
          font: inherit;
          text-align: left;
          transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
          pointer-events: auto;
        }
        button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 28px rgba(9, 30, 66, 0.34);
        }
        button:focus-visible {
          outline: 3px solid rgba(255, 255, 255, 0.95);
          outline-offset: 3px;
        }
        button.running { background: #c9372c; }
        button.config { background: #44546f; }
        button:disabled {
          cursor: not-allowed;
          opacity: 0.72;
          transform: none;
        }
        .icon {
          display: grid;
          place-items: center;
          width: 23px;
          height: 23px;
          flex: 0 0 23px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.18);
          font-size: 12px;
          font-weight: 800;
        }
        .copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .label {
          font-size: 14px;
          font-weight: 700;
          line-height: 1.2;
          white-space: nowrap;
        }
        .issue {
          max-width: 320px;
          overflow: hidden;
          color: rgba(255, 255, 255, 0.82);
          font-size: 11px;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .spinner {
          width: 11px;
          height: 11px;
          border: 2px solid rgba(255, 255, 255, 0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 700ms linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <div class="wrapper">
        <div id="message" class="message" role="status" aria-live="polite"></div>
        <button id="toggle" type="button">
          <span id="icon" class="icon">▶</span>
          <span class="copy">
            <span id="label" class="label">Start in Toggl</span>
            <span id="issue" class="issue"></span>
          </span>
        </button>
      </div>
    `;

    (document.body || document.documentElement).appendChild(host);

    return {
      host,
      button: shadow.getElementById("toggle"),
      icon: shadow.getElementById("icon"),
      label: shadow.getElementById("label"),
      issue: shadow.getElementById("issue"),
      message: shadow.getElementById("message"),
      messageTimer: null
    };
  }

  async function refreshIssueContext() {
    const sequence = ++state.refreshSequence;
    const key = extractIssueKey();

    if (!key) {
      state.issue = null;
      state.issueSignature = "";
      state.timerStatus = null;
      state.issueError = "";
      state.loadingIssue = false;
      render();
      return;
    }

    if (state.issue?.key !== key) {
      state.issue = createIssueShell(key);
      state.timerStatus = null;
      state.issueError = "";
      state.loadingIssue = true;
      render();
    }

    const fetchedIssue = await fetchIssueDetails(key);
    const summary = fetchedIssue?.summary || extractSummaryFromDom(key);

    if (sequence !== state.refreshSequence) {
      return;
    }

    state.loadingIssue = false;

    if (!summary) {
      state.issue = createIssueShell(key);
      state.issueSignature = `${key}:`;
      state.timerStatus = null;
      state.issueError = "Could not read the Jira issue title.";
      render();
      return;
    }

    const issue = {
      ...createIssueShell(key),
      ...(fetchedIssue || {}),
      key,
      summary,
      url: `${window.location.origin}/browse/${key}`
    };
    const signature = JSON.stringify(issue);

    if (signature === state.issueSignature) {
      state.issue = issue;
      render();
      return;
    }

    state.issue = issue;
    state.issueSignature = signature;
    state.issueError = "";
    render();
    await refreshTimerStatus();
  }

  function createIssueShell(key) {
    const keyParts = String(key).match(/^(.+)-(\d+)$/);
    return {
      key,
      summary: "",
      url: `${window.location.origin}/browse/${key}`,
      projectKey: keyParts?.[1] || "",
      projectName: "",
      issueNumber: keyParts?.[2] || "",
      issueType: "",
      status: "",
      assignee: "",
      reporter: "",
      priority: "",
      parentKey: "",
      labels: "",
      components: ""
    };
  }

  async function refreshTimerStatus() {
    if (!state.issue?.key || !state.issue.summary || state.busy) {
      return;
    }

    const issueSignature = state.issueSignature;
    const response = await sendMessage({
      type: "GET_TIMER_STATUS",
      issue: state.issue
    });

    if (issueSignature !== state.issueSignature) {
      return;
    }

    if (!response.ok) {
      state.timerStatus = null;
      state.issueError = response.error?.message || "Could not query Toggl.";
      render();
      return;
    }

    state.timerStatus = response.data;
    state.issueError = "";
    render();
  }

  async function handleButtonClick() {
    if (state.loadingIssue || !state.issue?.key) {
      return;
    }

    if (!state.issue.summary) {
      showMessage(state.issueError || "The Jira issue title is unavailable.", "error");
      return;
    }

    if (state.timerStatus?.configured === false) {
      await sendMessage({ type: "OPEN_OPTIONS" });
      showMessage("Complete the extension setup in the tab that was opened.");
      return;
    }

    state.busy = true;
    render();

    const shouldStop = Boolean(state.timerStatus?.isCurrentIssue);
    const response = await sendMessage({
      type: shouldStop ? "STOP_TIMER" : "START_TIMER",
      issue: state.issue
    });

    state.busy = false;

    if (!response.ok) {
      if (response.error?.code === "CONFIG_NOT_SET") {
        await sendMessage({ type: "OPEN_OPTIONS" });
      }

      showMessage(response.error?.message || "Could not complete the action.", "error");
      render();
      return;
    }

    const action = response.data?.action;
    if (action === "started") {
      const previousSync = response.data?.previousWorklogSync;
      if (response.data.stoppedPrevious && previousSync?.status === "synced") {
        showMessage(
          `The previous timer was logged to ${previousSync.issueKey}; the new issue was started.`,
          "success"
        );
      } else if (response.data.stoppedPrevious && previousSync?.status === "queued") {
        showMessage(
          "The previous timer stopped and its Jira Work Log is pending in the extension popup."
        );
      } else {
        showMessage(
          response.data.stoppedPrevious
            ? "The previous timer was stopped and the new issue was started."
            : "Timer started in Toggl.",
          "success"
        );
      }
    } else if (action === "already-running") {
      showMessage("This issue is already running in Toggl.", "success");
    } else if (action === "stopped") {
      const worklogSync = response.data?.worklogSync;
      if (worklogSync?.status === "synced") {
        showMessage(`Timer stopped and a Jira Work Log was created for ${worklogSync.issueKey}.`, "success");
      } else if (worklogSync?.status === "queued") {
        showMessage("Timer stopped. The Jira Work Log is pending in the extension popup.");
      } else {
        showMessage("Timer stopped in Toggl.", "success");
      }
    } else {
      showMessage("No timer was running.");
    }

    await refreshTimerStatus();
  }

  function render() {
    const hasIssue = Boolean(state.issue?.key);
    ui.host.style.display = hasIssue ? "block" : "none";

    if (!hasIssue) {
      return;
    }

    ui.button.classList.remove("running", "config");
    ui.button.disabled = false;
    ui.issue.textContent = state.issue.summary
      ? `${state.issue.key} · ${state.issue.summary}`
      : state.issue.key;

    if (state.loadingIssue) {
      ui.icon.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
      ui.label.textContent = "Reading issue…";
      ui.button.disabled = true;
      ui.button.title = "Reading issue data from Jira";
      return;
    }

    if (!state.issue.summary) {
      ui.icon.textContent = "!";
      ui.label.textContent = "Title unavailable";
      ui.button.disabled = false;
      ui.button.title = state.issueError || "Could not identify the Jira issue title";
      return;
    }

    if (state.busy) {
      ui.icon.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
      ui.label.textContent = state.timerStatus?.isCurrentIssue ? "Stopping…" : "Starting…";
      ui.button.disabled = true;
      ui.button.title = "Processing in Toggl Track";
      return;
    }

    if (state.timerStatus?.configured === false) {
      ui.button.classList.add("config");
      ui.icon.textContent = "⚙";
      ui.label.textContent = "Configure extension";
      ui.button.title = "Open the extension settings";
      return;
    }

    if (state.timerStatus?.isCurrentIssue) {
      ui.button.classList.add("running");
      ui.icon.textContent = "■";
      ui.label.textContent = "Stop in Toggl";
      ui.button.title = state.timerStatus.description || "Stop the timer for this issue";
      return;
    }

    ui.icon.textContent = "▶";
    ui.label.textContent = "Start in Toggl";
    ui.button.title = state.timerStatus?.description || `Start ${state.issue.key} in Toggl`;
  }

  function extractIssueKey() {
    const url = new URL(window.location.href);
    const pathMatch = url.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i);
    if (pathMatch) {
      return pathMatch[1].toUpperCase();
    }

    for (const parameter of [
      "selectedIssue",
      "issueKey",
      "selectedIssueKey",
      "focusedIssueKey",
      "modalIssueKey"
    ]) {
      const key = parseIssueKey(url.searchParams.get(parameter));
      if (key) {
        return key;
      }
    }

    const selectors = [
      '[role="dialog"] [data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]',
      '[role="dialog"] [data-testid*="breadcrumbs.current-issue"]',
      '[role="dialog"] [data-testid*="issue-key"]',
      '[role="dialog"] [data-testid*="breadcrumbs"] a[href*="/browse/"]',
      '[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]',
      '[data-testid*="breadcrumbs.current-issue"]',
      '[data-testid*="issue-key"]',
      'a[aria-current="page"][href*="/browse/"]'
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const key = parseIssueKey(
          `${element.getAttribute?.("href") || ""} ${element.textContent || ""}`
        );
        if (key) {
          return key;
        }
      }
    }

    return parseIssueKey(document.title);
  }

  async function fetchIssueDetails(key) {
    const cached = issueCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.issue;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);

    try {
      for (const apiVersion of JIRA_API_VERSIONS) {
        const endpoint = new URL(
          `/rest/api/${apiVersion}/issue/${encodeURIComponent(key)}`,
          window.location.origin
        );
        endpoint.searchParams.set("fields", JIRA_ISSUE_FIELDS);

        const response = await fetch(endpoint, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });

        if (response.ok) {
          const payload = await response.json();
          const issue = parseJiraIssue(key, payload);
          issueCache.set(key, {
            issue,
            expiresAt: Date.now() + ISSUE_CACHE_TTL_MS
          });
          return issue;
        }

        if (![404, 405].includes(response.status)) {
          break;
        }
      }

      issueCache.set(key, {
        issue: null,
        expiresAt: Date.now() + FAILED_CACHE_TTL_MS
      });
      return null;
    } catch {
      issueCache.set(key, {
        issue: null,
        expiresAt: Date.now() + FAILED_CACHE_TTL_MS
      });
      return null;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function parseJiraIssue(key, payload) {
    const fields = payload?.fields || {};
    const issue = createIssueShell(key);

    issue.summary = normalizeWhitespace(fields.summary || "");
    issue.projectKey = normalizeWhitespace(fields.project?.key || issue.projectKey);
    issue.projectName = normalizeWhitespace(fields.project?.name || "");
    issue.issueType = normalizeWhitespace(fields.issuetype?.name || "");
    issue.status = normalizeWhitespace(fields.status?.name || "");
    issue.assignee = normalizePerson(fields.assignee);
    issue.reporter = normalizePerson(fields.reporter);
    issue.priority = normalizeWhitespace(fields.priority?.name || "");
    issue.parentKey = normalizeWhitespace(fields.parent?.key || "");
    issue.labels = normalizeList(fields.labels);
    issue.components = normalizeList(fields.components, "name");

    return issue;
  }

  function normalizePerson(person) {
    if (!person || typeof person !== "object") {
      return "";
    }

    return normalizeWhitespace(
      person.displayName || person.name || person.emailAddress || person.accountId || ""
    );
  }

  function normalizeList(value, objectProperty = "") {
    if (!Array.isArray(value)) {
      return "";
    }

    return value
      .map((item) => {
        if (objectProperty && item && typeof item === "object") {
          return normalizeWhitespace(item[objectProperty] || "");
        }

        return normalizeWhitespace(item || "");
      })
      .filter(Boolean)
      .join(", ");
  }

  function extractSummaryFromDom(key) {
    const selectors = [
      '[role="dialog"] [data-testid="issue.views.issue-base.foundation.summary.heading"]',
      '[role="dialog"] [data-testid*="foundation.summary.heading"]',
      '[role="dialog"] [data-testid*="summary.heading"]',
      '[role="dialog"] textarea[aria-label="Summary"]',
      '[role="dialog"] input[aria-label="Summary"]',
      '[role="dialog"] h1',
      '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
      '[data-testid*="foundation.summary.heading"]',
      '[data-testid*="summary.heading"]',
      'textarea[aria-label="Summary"]',
      'input[aria-label="Summary"]'
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rawValue =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : element.textContent;
        const summary = normalizeWhitespace(rawValue || "");

        if (summary && summary.toUpperCase() !== key && summary.length <= 1000) {
          return summary;
        }
      }
    }

    const escapedKey = escapeRegExp(key);
    const documentTitle = normalizeWhitespace(document.title);
    const titlePatterns = [
      new RegExp(`^\\[${escapedKey}\\]\\s*(.+?)(?:\\s+-\\s+Jira.*)?$`, "i"),
      new RegExp(`^${escapedKey}\\s*[-:|]?\\s*(.+?)(?:\\s+-\\s+Jira.*)?$`, "i")
    ];

    for (const pattern of titlePatterns) {
      const match = documentTitle.match(pattern);
      if (match?.[1]) {
        return normalizeWhitespace(match[1]);
      }
    }

    return "";
  }

  function parseIssueKey(value) {
    const match = String(value || "").match(/\b([A-Z][A-Z0-9_]*-\d+)\b/i);
    return match ? match[1].toUpperCase() : "";
  }

  async function sendMessage(message) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      return response || {
        ok: false,
        error: { code: "NO_RESPONSE", message: "The extension did not respond." }
      };
    } catch {
      return {
        ok: false,
        error: {
          code: "EXTENSION_UNAVAILABLE",
          message: "The extension was updated or reloaded. Reload this Jira page."
        }
      };
    }
  }

  function showMessage(text, type = "") {
    window.clearTimeout(ui.messageTimer);
    ui.message.textContent = text;
    ui.message.className = `message visible${type ? ` ${type}` : ""}`;

    ui.messageTimer = window.setTimeout(() => {
      ui.message.className = "message";
    }, 4000);
  }

  function normalizeWhitespace(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function debounce(callback, delay) {
    let timeoutId = null;

    return (...args) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => callback(...args), delay);
    };
  }
})();
