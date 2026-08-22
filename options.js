"use strict";

const DEFAULT_TEMPLATE = "[{key}] {summary}";
const TOGGL_ACCOUNTS_MATCH = "https://accounts.toggl.com/*";
const TOGGL_TRACK_WEB_MATCH = "https://track.toggl.com/*";
const TOGGL_CONNECTION_MATCHES = [TOGGL_ACCOUNTS_MATCH, TOGGL_TRACK_WEB_MATCH];
const TEMPLATE_PREVIEW_VALUES = Object.freeze({
  key: "PROJ-123",
  summary: "Example Jira issue",
  url: "https://jira.example.com/browse/PROJ-123",
  projectKey: "PROJ",
  projectName: "Example Project",
  issueNumber: "123",
  issueType: "Story",
  status: "In Progress",
  assignee: "Alex Developer",
  reporter: "Morgan Product",
  priority: "High",
  parentKey: "PROJ-100",
  labels: "frontend, cleanup",
  components: "Web App"
});

const form = document.getElementById("settings-form");
const jiraOriginInput = document.getElementById("jira-origin");
const workspaceIdInput = document.getElementById("workspace-id");
const projectIdInput = document.getElementById("project-id");
const floatingButtonPositionInput = document.getElementById("floating-button-position");
const templateInput = document.getElementById("description-template");
const billableInput = document.getElementById("billable");
const stopExistingInput = document.getElementById("stop-existing");
const syncWorklogsInput = document.getElementById("sync-worklogs");
const worklogSyncModeInput = document.getElementById("worklog-sync-mode");
const worklogRoundingInput = document.getElementById("worklog-rounding");
const worklogCommentTemplateInput = document.getElementById("worklog-comment-template");
const worklogOptions = document.getElementById("worklog-options");
const worklogState = document.getElementById("worklog-state");
const pendingWorklogs = document.getElementById("pending-worklogs");
const advancedSettings = document.getElementById("advanced-settings");
const billingState = document.getElementById("billing-state");
const descriptionPreview = document.getElementById("description-preview");
const saveButton = document.getElementById("save-button");
const clearButton = document.getElementById("clear-button");
const statusElement = document.getElementById("status");
const connectionBadge = document.getElementById("connection-badge");
const connectTogglButton = document.getElementById("connect-toggl");
const togglAccountState = document.getElementById("toggl-account-state");
const variableButtons = [...document.querySelectorAll("[data-variable]")];
const worklogVariableButtons = [...document.querySelectorAll("[data-worklog-variable]")];

let currentJiraOrigin = "";
let hasConnectedToggl = false;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

clearButton.addEventListener("click", () => {
  void clearSettings();
});

connectTogglButton.addEventListener("click", () => {
  void connectToggl();
});

billableInput.addEventListener("change", updatePreview);
syncWorklogsInput.addEventListener("change", updatePreview);
templateInput.addEventListener("input", updatePreview);

for (const button of variableButtons) {
  button.addEventListener("click", () => {
    insertVariable(templateInput, button.dataset.variable || "");
  });
}

for (const button of worklogVariableButtons) {
  button.addEventListener("click", () => {
    insertVariable(worklogCommentTemplateInput, button.dataset.worklogVariable || "");
  });
}

void loadSettings();

async function loadSettings() {
  const response = await sendMessage({ type: "GET_OPTIONS_STATE" });

  if (!response.ok) {
    showStatus(response.error?.message || "Could not load the extension settings.", "error");
    return;
  }

  applySettings(response.data);
}

function applySettings(settings) {
  currentJiraOrigin = settings.jiraOrigin || "";
  jiraOriginInput.value = currentJiraOrigin;
  workspaceIdInput.value = settings.workspaceId || "";
  projectIdInput.value = settings.projectId || "";
  floatingButtonPositionInput.value = settings.floatingButtonPosition || "bottom-right";
  templateInput.value = settings.descriptionTemplate || DEFAULT_TEMPLATE;
  billableInput.checked = settings.billable === true;
  stopExistingInput.checked = settings.stopExisting !== false;
  syncWorklogsInput.checked = settings.syncWorklogs === true;
  worklogSyncModeInput.value = settings.worklogSyncMode || "automatic";
  worklogRoundingInput.value = settings.worklogRounding || "nearest-minute";
  worklogCommentTemplateInput.value = settings.worklogCommentTemplate ??
    "Synced from Toggl: {description}";
  applyTogglConnectionState(settings);

  advancedSettings.open = Boolean(
    settings.descriptionTemplate !== DEFAULT_TEMPLATE ||
    settings.stopExisting === false ||
    settings.floatingButtonPosition !== "bottom-right"
  );

  renderPendingWorklogs(settings.pendingWorklogCount);
  renderConnectionBadge(settings);
  updatePreview();
}

function renderPendingWorklogs(value) {
  const pendingCount = Number(value || 0);
  pendingWorklogs.textContent = pendingCount === 1
    ? "1 Jira Work Log is waiting in the side-panel retry queue."
    : `${pendingCount} Jira Work Logs are waiting in the side-panel retry queue.`;
  pendingWorklogs.classList.toggle("hidden", pendingCount === 0);
}

function renderConnectionBadge(settings) {
  connectionBadge.classList.remove("connected");

  if (settings.configured) {
    const project = settings.projectName ? ` · ${settings.projectName}` : "";
    connectionBadge.textContent = settings.workspaceName
      ? `Ready · ${settings.workspaceName}${project}`
      : "Ready";
    connectionBadge.classList.add("connected");
  } else if (settings.togglConfigured && !settings.jiraConfigured) {
    connectionBadge.textContent = "Jira access needed";
  } else {
    connectionBadge.textContent = "Not configured";
  }
}

function applyTogglConnectionState(settings) {
  hasConnectedToggl = settings.hasApiToken === true;
  togglAccountState.textContent = hasConnectedToggl
    ? `Connected${settings.profileName ? ` as ${settings.profileName}` : ""}`
    : "Not connected";
  togglAccountState.classList.toggle("connected", hasConnectedToggl);
  connectTogglButton.textContent = hasConnectedToggl ? "Reconnect Toggl" : "Connect Toggl";
}

async function connectToggl() {
  setConnectBusy(true);
  showStatus("Requesting access to Toggl…");
  const permissionGranted = await requestTogglConnectionPermissions();
  if (!permissionGranted) {
    return;
  }

  showStatus("Checking your signed-in Toggl account…");
  const response = await sendMessage({ type: "CONNECT_TOGGL" });
  setConnectBusy(false);
  renderTogglConnectionResult(response);
}

async function requestTogglConnectionPermissions() {
  try {
    const granted = await chrome.permissions.request({
      origins: TOGGL_CONNECTION_MATCHES
    });
    if (!granted) {
      setConnectBusy(false);
      showStatus("Toggl access was not granted. No account data was read.", "error");
    }
    return granted;
  } catch {
    setConnectBusy(false);
    showStatus("Chrome could not request access to Toggl Accounts and Track.", "error");
    return false;
  }
}

function renderTogglConnectionResult(response) {
  if (!response.ok) {
    if (["TOGGL_LOGIN_REQUIRED", "TOGGL_TRACK_SESSION_REQUIRED"]
      .includes(response.error?.code)) {
      connectTogglButton.textContent = "Retry connection";
    }
    showStatus(response.error?.message || "Could not connect Toggl.", "error");
    return;
  }

  applyTogglConnectionState(response.data);
  workspaceIdInput.value = response.data.workspaceId || "";
  projectIdInput.value = response.data.projectId || "";
  renderPendingWorklogs(response.data.pendingWorklogCount);
  renderConnectionBadge(response.data);
  const account = response.data.profileName ? ` as ${response.data.profileName}` : "";
  const nextStep = response.data.configured
    ? "Your saved settings remain ready."
    : "Save your Jira settings to finish setup.";
  showStatus(`Toggl connected${account}. ${nextStep}`, "success");
}

async function saveSettings() {
  if (!hasConnectedToggl) {
    showStatus("Connect Toggl before saving settings.", "error");
    connectTogglButton.focus();
    return;
  }

  let jiraOrigin;

  try {
    jiraOrigin = normalizeJiraOrigin(jiraOriginInput.value);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Enter a valid Jira site URL.", "error");
    jiraOriginInput.focus();
    return;
  }

  jiraOriginInput.value = jiraOrigin;
  setBusy(true);
  showStatus(`Requesting access to ${jiraOrigin}…`);

  let permissionGranted = false;
  try {
    // This call stays directly inside the form submission user gesture.
    permissionGranted = await chrome.permissions.request({
      origins: [toJiraMatchPattern(jiraOrigin)]
    });
  } catch {
    setBusy(false);
    showStatus("Chrome could not request access to the Jira site.", "error");
    return;
  }

  if (!permissionGranted) {
    setBusy(false);
    showStatus(
      "Jira site access was not granted. The extension needs it to add the timer button inside Jira.",
      "error"
    );
    return;
  }

  showStatus("Checking your Toggl account, workspace, and optional project…");

  const response = await sendMessage({
    type: "VALIDATE_AND_SAVE_SETTINGS",
    settings: {
      jiraOrigin,
      workspaceId: workspaceIdInput.value,
      projectId: projectIdInput.value,
      billable: billableInput.checked,
      descriptionTemplate: templateInput.value,
      stopExisting: stopExistingInput.checked,
      syncWorklogs: syncWorklogsInput.checked,
      worklogSyncMode: worklogSyncModeInput.value,
      worklogRounding: worklogRoundingInput.value,
      worklogCommentTemplate: worklogCommentTemplateInput.value,
      floatingButtonPosition: floatingButtonPositionInput.value
    }
  });

  setBusy(false);

  if (!response.ok) {
    if (jiraOrigin !== currentJiraOrigin) {
      await chrome.permissions
        .remove({ origins: [toJiraMatchPattern(jiraOrigin)] })
        .catch(() => false);
    }

    showStatus(response.error?.message || "Could not save the settings.", "error");
    return;
  }

  applySettings(response.data);

  const account = response.data.profileName ? ` Account: ${response.data.profileName}.` : "";
  const workspace = response.data.workspaceName
    ? ` Workspace: ${response.data.workspaceName}.`
    : "";
  const project = response.data.projectName ? ` Project: ${response.data.projectName}.` : "";
  const billing = response.data.billable ? " Billable: on." : " Billable: off.";
  const worklogs = response.data.syncWorklogs
    ? ` Jira Work Logs: ${response.data.worklogSyncMode === "manual" ? "ask before syncing" : "automatic"}.`
    : " Jira Work Logs: off.";

  showStatus(
    `Settings saved.${account}${workspace}${project}${billing}${worklogs} Reload Jira tabs that were already open.`,
    "success"
  );
}

async function clearSettings() {
  const confirmed = window.confirm(
    "Remove the Toggl connection, preferences, pending Work Logs, and site permissions from this Chrome profile?"
  );

  if (!confirmed) {
    return;
  }

  setBusy(true);
  const response = await sendMessage({ type: "CLEAR_SETTINGS" });
  setBusy(false);

  if (!response.ok) {
    showStatus(response.error?.message || "Could not remove the settings.", "error");
    return;
  }

  currentJiraOrigin = "";
  form.reset();
  templateInput.value = DEFAULT_TEMPLATE;
  billableInput.checked = false;
  stopExistingInput.checked = true;
  syncWorklogsInput.checked = false;
  worklogSyncModeInput.value = "automatic";
  worklogRoundingInput.value = "nearest-minute";
  worklogCommentTemplateInput.value = "Synced from Toggl: {description}";
  floatingButtonPositionInput.value = "bottom-right";
  pendingWorklogs.classList.add("hidden");
  advancedSettings.open = false;
  applyTogglConnectionState({ hasApiToken: false });
  connectionBadge.textContent = "Not configured";
  connectionBadge.classList.remove("connected");
  updatePreview();
  const cleanupWarning = response.data?.permissionCleanupWarning;
  showStatus(
    cleanupWarning ||
      "Settings, the Toggl connection, and site access were removed from this Chrome profile.",
    cleanupWarning ? "error" : "success"
  );
}

function updatePreview() {
  let rendered = templateInput.value.trim() || DEFAULT_TEMPLATE;

  for (const [name, value] of Object.entries(TEMPLATE_PREVIEW_VALUES)) {
    rendered = rendered.replaceAll(`{${name}}`, value);
  }

  descriptionPreview.textContent = rendered.replace(/\s+/g, " ").trim();

  const isBillable = billableInput.checked;
  billingState.textContent = isBillable ? "On" : "Off";
  billingState.classList.toggle("on", isBillable);

  const syncWorklogs = syncWorklogsInput.checked;
  worklogState.textContent = syncWorklogs ? "On" : "Off";
  worklogState.classList.toggle("on", syncWorklogs);
  worklogOptions.classList.toggle("hidden", !syncWorklogs);
}

function insertVariable(input, variable) {
  if (!variable) {
    return;
  }

  const start = Number.isInteger(input.selectionStart)
    ? input.selectionStart
    : input.value.length;
  const end = Number.isInteger(input.selectionEnd)
    ? input.selectionEnd
    : start;

  input.value = `${input.value.slice(0, start)}${variable}${input.value.slice(end)}`;
  const cursor = start + variable.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
  updatePreview();
}

function normalizeJiraOrigin(value) {
  let rawValue = String(value || "").trim();

  if (!rawValue) {
    throw new Error("Enter your Jira site URL.");
  }

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(rawValue)) {
    rawValue = `https://${rawValue}`;
  }

  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("Enter a valid Jira URL, such as https://your-company.atlassian.net.");
  }

  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("The Jira site must use a valid HTTPS URL without embedded credentials.");
  }

  return url.origin;
}

function toJiraMatchPattern(jiraOrigin) {
  const url = new URL(jiraOrigin);
  return `${url.protocol}//${url.host}/*`;
}

function setBusy(busy) {
  saveButton.disabled = busy;
  clearButton.disabled = busy;
  connectTogglButton.disabled = busy;
  saveButton.textContent = busy ? "Saving…" : "Save settings";
}

function setConnectBusy(busy) {
  connectTogglButton.disabled = busy;
  saveButton.disabled = busy;
  clearButton.disabled = busy;
  connectTogglButton.textContent = busy
    ? "Connecting…"
    : hasConnectedToggl ? "Reconnect Toggl" : "Connect Toggl";
}

function showStatus(message, type = "") {
  statusElement.textContent = message;
  statusElement.className = `status visible${type ? ` ${type}` : ""}`;
}

async function sendMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response || {
      ok: false,
      error: { message: "The extension did not respond." }
    };
  } catch {
    return {
      ok: false,
      error: { message: "The extension was reloaded. Reopen this settings page." }
    };
  }
}
