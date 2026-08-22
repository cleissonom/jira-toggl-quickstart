"use strict";

(() => {
  if (window.top !== window) {
    return;
  }

  const ROOT_ID = "jira-toggl-quickstart-root";
  const ISSUE_CACHE_TTL_MS = 10 * 60 * 1000;
  const FAILED_CACHE_TTL_MS = 30 * 1000;
  const JIRA_API_VERSIONS = ["3", "2", "latest"];
  const FLOATING_BUTTON_POSITIONS = [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right"
  ];
  const FLOATING_POSITION_ANCHORS = Object.freeze({
    "top-left": { top: "24px", right: "auto", bottom: "auto", left: "24px" },
    "top-right": { top: "24px", right: "24px", bottom: "auto", left: "auto" },
    "bottom-left": { top: "auto", right: "auto", bottom: "24px", left: "24px" },
    "bottom-right": { top: "auto", right: "24px", bottom: "24px", left: "auto" }
  });
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
    copyText: "",
    copyStatus: "idle",
    copyError: "",
    copyBusy: false,
    copySucceeded: false,
    copyRefreshSequence: 0,
    floatingButtonPosition: "bottom-right",
    refreshSequence: 0,
    lastHref: window.location.href
  };

  const ui = createUi();
  const scheduleIssueRefresh = debounce(refreshIssueContext, 250);
  const scheduleClipboardRefresh = debounce(refreshJiraClipboard, 1500);

  ui.button.addEventListener("click", () => {
    void handleButtonClick();
  });

  ui.copyButton.addEventListener("click", () => {
    void handleCopyButtonClick();
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
    void refreshUiSettings();
    void refreshTimerStatus();
    if (state.copyStatus === "error") {
      void refreshJiraClipboard();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshUiSettings();
      scheduleIssueRefresh();
      void refreshTimerStatus();
    }
  });

  document.addEventListener("input", scheduleClipboardRefresh, true);

  void refreshUiSettings();
  void refreshIssueContext();

  function createUi() {
    document.getElementById(ROOT_ID)?.remove();

    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.dataset.position = "bottom-right";
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
        :host([data-position^="top-"]) .wrapper { flex-direction: column-reverse; }
        :host([data-position$="left"]) .wrapper { align-items: flex-start; }
        :host([data-position$="right"]) .wrapper { align-items: flex-end; }
        .controls {
          display: flex;
          max-width: calc(100vw - 48px);
          align-items: stretch;
          gap: 8px;
          pointer-events: none;
        }
        :host([data-position$="right"]) .controls { flex-direction: row-reverse; }
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
          pointer-events: none;
        }
        .message.visible {
          opacity: 1;
          transform: translateY(0);
        }
        .message.error { background: #ae2a19; }
        .message.success { background: #216e4e; }
        .controls button {
          display: inline-flex;
          align-items: center;
          min-height: 48px;
          border-radius: 999px;
          box-shadow: 0 8px 24px rgba(9, 30, 66, 0.28);
          cursor: pointer;
          font: inherit;
          transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
          pointer-events: auto;
        }
        .controls button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 28px rgba(9, 30, 66, 0.34);
        }
        .controls button:focus-visible {
          outline: 3px solid #172b4d;
          outline-offset: 3px;
        }
        .timer-button {
          gap: 10px;
          max-width: 420px;
          min-width: 0;
          padding: 9px 16px;
          border: 0;
          background: #0c66e4;
          color: #fff;
          text-align: left;
        }
        .timer-button.running { background: #c9372c; }
        .timer-button.config { background: #44546f; }
        .copy-button {
          flex: 0 0 auto;
          gap: 7px;
          padding: 9px 14px;
          border: 1px solid #b7b9c0;
          background: #fff;
          color: #172b4d;
          font-weight: 750;
        }
        .copy-button:hover:not(:disabled) { background: #f1f2f4; }
        .copy-button.copying .copy-icon {
          animation: copy-pulse 650ms ease-in-out infinite alternate;
        }
        .copy-button.copied {
          border-color: #7ee2b8;
          background: #dcfff1;
          color: #216e4e;
        }
        .copy-button.copied .copy-icon {
          animation: copy-success 480ms cubic-bezier(0.2, 0.9, 0.3, 1.3);
        }
        .controls button:disabled {
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
        @keyframes copy-pulse {
          from { transform: scale(0.9); opacity: 0.65; }
          to { transform: scale(1.12); opacity: 1; }
        }
        @keyframes copy-success {
          0% { transform: scale(0.75) rotate(-12deg); }
          65% { transform: scale(1.28) rotate(4deg); }
          100% { transform: scale(1) rotate(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .controls button { transition: none; }
          .copy-button.copying .copy-icon,
          .copy-button.copied .copy-icon,
          .spinner { animation: none; }
        }
      </style>
      <div class="wrapper">
        <div id="message" class="message" role="status" aria-live="polite"></div>
        <div class="controls">
          <button id="toggle" class="timer-button" type="button">
            <span id="icon" class="icon" aria-hidden="true">▶</span>
            <span class="copy">
              <span id="label" class="label">Start in Toggl</span>
              <span id="issue" class="issue"></span>
            </span>
          </button>
          <button
            id="copy-jira"
            class="copy-button"
            type="button"
            aria-label="Copy Jira title & description"
            title="Copy Jira title & description"
          ><span id="copy-icon" class="copy-icon" aria-hidden="true">⧉</span><span id="copy-label">Copy</span></button>
        </div>
      </div>
    `;

    (document.body || document.documentElement).appendChild(host);

    return {
      host,
      button: shadow.getElementById("toggle"),
      copyButton: shadow.getElementById("copy-jira"),
      copyIcon: shadow.getElementById("copy-icon"),
      copyLabel: shadow.getElementById("copy-label"),
      icon: shadow.getElementById("icon"),
      label: shadow.getElementById("label"),
      issue: shadow.getElementById("issue"),
      message: shadow.getElementById("message"),
      messageTimer: null,
      copySuccessTimer: null
    };
  }

  async function refreshUiSettings() {
    const response = await sendMessage({ type: "GET_JIRA_UI_SETTINGS" });
    if (!response.ok) {
      return;
    }
    applyFloatingButtonPosition(response.data?.floatingButtonPosition);
  }

  function applyFloatingButtonPosition(value) {
    const position = FLOATING_BUTTON_POSITIONS.includes(value)
      ? value
      : "bottom-right";
    state.floatingButtonPosition = position;
    ui.host.dataset.position = position;
    Object.assign(ui.host.style, FLOATING_POSITION_ANCHORS[position]);
  }

  function resetCopyState(status = "idle") {
    window.clearTimeout(ui.copySuccessTimer);
    state.copyRefreshSequence += 1;
    state.copyText = "";
    state.copyStatus = status;
    state.copyError = "";
    state.copyBusy = false;
    state.copySucceeded = false;
    return state.copyRefreshSequence;
  }

  async function refreshIssueContext() {
    const sequence = ++state.refreshSequence;
    const key = extractIssueKey();

    if (!key) {
      state.issue = null;
      state.issueSignature = "";
      state.timerStatus = null;
      state.issueError = "";
      resetCopyState();
      state.loadingIssue = false;
      render();
      return;
    }

    if (state.issue?.key !== key) {
      state.issue = createIssueShell(key);
      state.timerStatus = null;
      state.issueError = "";
      resetCopyState("loading");
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
    await Promise.all([refreshTimerStatus(), refreshJiraClipboard()]);
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

  async function refreshJiraClipboard() {
    const issueKey = state.issue?.key;
    const issueSignature = state.issueSignature;
    if (!issueKey) {
      return;
    }

    const refreshSequence = resetCopyState("loading");
    render();
    const response = await sendMessage({
      type: "GET_JIRA_CLIPBOARD",
      issueKey
    });
    if (
      refreshSequence !== state.copyRefreshSequence ||
      issueKey !== state.issue?.key ||
      issueSignature !== state.issueSignature
    ) {
      return;
    }
    applyClipboardResponse(response);
    render();
  }

  function applyClipboardResponse(response) {
    const clipboardText = response.ok
      ? String(response.data?.clipboardText || "")
      : "";
    state.copyText = clipboardText;
    state.copyStatus = clipboardText ? "ready" : "error";
    state.copyError = clipboardText
      ? ""
      : response.error?.message || "Jira title and description could not be loaded.";
  }

  async function handleCopyButtonClick() {
    if (state.copyBusy) {
      return;
    }
    if (state.copyStatus === "error") {
      await retryJiraClipboard();
      return;
    }
    if (state.copyStatus !== "ready" || !state.copyText) {
      showMessage("Jira title and description are not ready to copy.", "error");
      return;
    }

    let copyOperation;
    try {
      copyOperation = navigator.clipboard.writeText(state.copyText);
    } catch {
      showCopyFailure();
      return;
    }

    state.copyBusy = true;
    state.copySucceeded = false;
    renderCopyButton();
    try {
      await copyOperation;
      showCopySuccess();
      showMessage("Copied Jira title & description.", "success");
    } catch {
      showCopyFailure();
    } finally {
      state.copyBusy = false;
      renderCopyButton();
    }
  }

  async function retryJiraClipboard() {
    showMessage("Refreshing Jira title & description…");
    await refreshJiraClipboard();
    if (state.copyStatus === "ready") {
      showMessage("Jira details are ready. Click Copy again.", "success");
      return;
    }
    showMessage(state.copyError, "error");
  }

  function showCopyFailure() {
    state.copySucceeded = false;
    showMessage(
      "Could not copy Jira details. Check clipboard access and try again.",
      "error"
    );
  }

  function showCopySuccess() {
    window.clearTimeout(ui.copySuccessTimer);
    state.copySucceeded = true;
    renderCopyButton();
    ui.copySuccessTimer = window.setTimeout(() => {
      state.copySucceeded = false;
      renderCopyButton();
    }, 1400);
  }

  async function handleButtonClick() {
    if (state.loadingIssue || !state.issue?.key) {
      return;
    }

    if (!state.issue.summary) {
      showMessage(state.issueError || "The Jira issue title is unavailable.", "error");
      return;
    }

    const shouldStop = Boolean(state.timerStatus?.isCurrentIssue);
    if (!shouldStop && state.timerStatus?.configured === false) {
      await sendMessage({ type: "OPEN_OPTIONS" });
      showMessage("Complete the extension setup in the tab that was opened.");
      return;
    }

    state.busy = true;
    render();
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
          "The previous timer stopped and its Jira Work Log is pending in the extension side panel."
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
        showMessage("Timer stopped. The Jira Work Log is pending in the extension side panel.");
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
    renderCopyButton();

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

    if (state.timerStatus?.isCurrentIssue) {
      ui.button.classList.add("running");
      ui.icon.textContent = "■";
      ui.label.textContent = "Stop in Toggl";
      ui.button.title = state.timerStatus.description || "Stop the timer for this issue";
      return;
    }

    if (state.timerStatus?.configured === false) {
      ui.button.classList.add("config");
      ui.icon.textContent = "⚙";
      ui.label.textContent = "Configure extension";
      ui.button.title = "Open the extension settings";
      return;
    }

    ui.icon.textContent = "▶";
    ui.label.textContent = "Start in Toggl";
    ui.button.title = state.timerStatus?.description || `Start ${state.issue.key} in Toggl`;
  }

  function renderCopyButton() {
    ui.copyButton.classList.remove("copying", "copied");
    if (state.copyBusy) ui.copyButton.classList.add("copying");
    if (state.copySucceeded) ui.copyButton.classList.add("copied");
    ui.copyIcon.textContent = state.copySucceeded ? "✓" : "⧉";
    ui.copyLabel.textContent = state.copyStatus === "error" ? "Retry" : "Copy";
    ui.copyButton.disabled = state.copyBusy || !["ready", "error"].includes(state.copyStatus);
    ui.copyButton.ariaLabel = state.copyStatus === "error"
      ? "Retry preparing Jira title & description"
      : "Copy Jira title & description";
    if (state.copyBusy) {
      ui.copyButton.title = "Copying Jira title & description";
      return;
    }
    ui.copyButton.title = state.copySucceeded
      ? "Jira title & description copied"
      : state.copyStatus === "error"
        ? state.copyError
      : state.copyStatus === "ready"
        ? "Copy Jira title & description"
        : "Preparing Jira title & description";
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
