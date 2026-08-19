"use strict";

const DEFAULT_TEMPLATE = "[{key}] {summary}";
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
const apiTokenInput = document.getElementById("api-token");
const workspaceIdInput = document.getElementById("workspace-id");
const projectIdInput = document.getElementById("project-id");
const templateInput = document.getElementById("description-template");
const billableInput = document.getElementById("billable");
const stopExistingInput = document.getElementById("stop-existing");
const advancedSettings = document.getElementById("advanced-settings");
const billingState = document.getElementById("billing-state");
const descriptionPreview = document.getElementById("description-preview");
const saveButton = document.getElementById("save-button");
const clearButton = document.getElementById("clear-button");
const statusElement = document.getElementById("status");
const connectionBadge = document.getElementById("connection-badge");
const variableButtons = [...document.querySelectorAll("[data-variable]")];

let currentJiraOrigin = "";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

clearButton.addEventListener("click", () => {
  void clearSettings();
});

billableInput.addEventListener("change", updatePreview);
templateInput.addEventListener("input", updatePreview);

for (const button of variableButtons) {
  button.addEventListener("click", () => {
    insertTemplateVariable(button.dataset.variable || "");
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
  templateInput.value = settings.descriptionTemplate || DEFAULT_TEMPLATE;
  billableInput.checked = settings.billable === true;
  stopExistingInput.checked = settings.stopExisting !== false;
  apiTokenInput.required = !settings.hasApiToken;

  if (settings.hasApiToken) {
    apiTokenInput.placeholder = "Token already saved; leave blank to keep it";
  } else {
    apiTokenInput.placeholder = "Paste your Toggl API token";
  }

  advancedSettings.open = Boolean(
    settings.projectId ||
    settings.descriptionTemplate !== DEFAULT_TEMPLATE ||
    settings.stopExisting === false
  );

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

  updatePreview();
}

async function saveSettings() {
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

  showStatus("Checking your Toggl account and saving the defaults…");

  const response = await sendMessage({
    type: "VALIDATE_AND_SAVE_SETTINGS",
    settings: {
      jiraOrigin,
      apiToken: apiTokenInput.value,
      workspaceId: workspaceIdInput.value,
      projectId: projectIdInput.value,
      billable: billableInput.checked,
      descriptionTemplate: templateInput.value,
      stopExisting: stopExistingInput.checked
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

  apiTokenInput.value = "";
  applySettings(response.data);

  const account = response.data.profileName ? ` Account: ${response.data.profileName}.` : "";
  const workspace = response.data.workspaceName
    ? ` Workspace: ${response.data.workspaceName}.`
    : "";
  const project = response.data.projectName ? ` Project: ${response.data.projectName}.` : "";
  const billing = response.data.billable ? " Billable: on." : " Billable: off.";

  showStatus(
    `Settings saved.${account}${workspace}${project}${billing} Reload Jira tabs that were already open.`,
    "success"
  );
}

async function clearSettings() {
  const confirmed = window.confirm(
    "Remove the saved token, preferences, and Jira site permission from this Chrome profile?"
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
  advancedSettings.open = false;
  apiTokenInput.required = true;
  apiTokenInput.placeholder = "Paste your Toggl API token";
  connectionBadge.textContent = "Not configured";
  connectionBadge.classList.remove("connected");
  updatePreview();
  showStatus("Settings and Jira site access were removed from this Chrome profile.", "success");
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
}

function insertTemplateVariable(variable) {
  if (!variable) {
    return;
  }

  const start = Number.isInteger(templateInput.selectionStart)
    ? templateInput.selectionStart
    : templateInput.value.length;
  const end = Number.isInteger(templateInput.selectionEnd)
    ? templateInput.selectionEnd
    : start;

  templateInput.value = `${templateInput.value.slice(0, start)}${variable}${templateInput.value.slice(end)}`;
  const cursor = start + variable.length;
  templateInput.focus();
  templateInput.setSelectionRange(cursor, cursor);
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
  saveButton.textContent = busy ? "Saving…" : "Connect and save";
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
