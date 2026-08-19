"use strict";

const STORAGE_KEY = "jiraTogglSettings";
const DYNAMIC_CONTENT_SCRIPT_ID = "jira-toggl-quick-start-content";
const TOGGL_API_BASE_URL = "https://api.track.toggl.com";
const CREATED_WITH = "jira-toggl-quickstart-chrome";

const ISSUE_TEMPLATE_VARIABLES = Object.freeze([
  "key",
  "summary",
  "url",
  "projectKey",
  "projectName",
  "issueNumber",
  "issueType",
  "status",
  "assignee",
  "reporter",
  "priority",
  "parentKey",
  "labels",
  "components"
]);
const ISSUE_TEMPLATE_VARIABLE_SET = new Set(ISSUE_TEMPLATE_VARIABLES);

const DEFAULT_SETTINGS = Object.freeze({
  apiToken: "",
  jiraOrigin: "",
  workspaceId: null,
  workspaceName: "",
  profileName: "",
  projectId: null,
  projectName: "",
  billable: false,
  descriptionTemplate: "[{key}] {summary}",
  stopExisting: true
});

class UserFacingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UserFacingError";
    this.code = code;
  }
}

// The API token remains available only to trusted extension pages and the
// service worker. Jira content scripts cannot read chrome.storage.local.
void chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch(() => undefined);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void initializeExtension(reason);
});

chrome.runtime.onStartup.addListener(() => {
  scheduleContentScriptSync();
});

chrome.permissions.onAdded.addListener(() => {
  scheduleContentScriptSync();
});

chrome.permissions.onRemoved.addListener(() => {
  scheduleContentScriptSync();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));

  return true;
});

async function initializeExtension(reason) {
  try {
    const settings = await getSettings();
    await syncJiraContentScript(settings);

    if (reason === "install" || !settings.jiraOrigin) {
      await chrome.runtime.openOptionsPage();
    }
  } catch (error) {
    console.error("Could not initialize Jira → Toggl Quick Start.", error);
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    throw new UserFacingError(
      "INVALID_MESSAGE",
      "The extension received an invalid message."
    );
  }

  switch (message.type) {
    case "GET_TIMER_STATUS":
      await assertJiraOrExtensionSender(sender);
      return getTimerStatus(message.issue);

    case "START_TIMER":
      await assertJiraSender(sender);
      return startTimer(message.issue);

    case "START_MANUAL_TIMER":
      assertExtensionPageSender(sender);
      return startManualTimer(message.description);

    case "STOP_TIMER":
      await assertJiraSender(sender);
      return stopTimerForIssue(message.issue);

    case "GET_POPUP_STATE":
      assertExtensionPageSender(sender);
      return getPopupState();

    case "STOP_CURRENT_TIMER":
      assertExtensionPageSender(sender);
      return stopCurrentTimer();

    case "GET_OPTIONS_STATE":
      assertExtensionPageSender(sender);
      return getOptionsState();

    case "VALIDATE_AND_SAVE_SETTINGS":
      assertExtensionPageSender(sender);
      return validateAndSaveSettings(message.settings);

    case "CLEAR_SETTINGS":
      assertExtensionPageSender(sender);
      return clearSettings();

    case "OPEN_OPTIONS":
      await assertJiraOrExtensionSender(sender);
      await chrome.runtime.openOptionsPage();
      return { opened: true };

    default:
      throw new UserFacingError("UNKNOWN_MESSAGE", "Unknown extension action.");
  }
}

async function assertJiraSender(sender) {
  const settings = await getSettings();

  if (!isJiraSenderForSettings(sender, settings)) {
    throw new UserFacingError(
      "UNTRUSTED_SENDER",
      "This page is not the authorized Jira site."
    );
  }
}

function assertExtensionPageSender(sender) {
  if (!isExtensionPageSender(sender)) {
    throw new UserFacingError(
      "UNTRUSTED_SENDER",
      "This message came from an unauthorized source."
    );
  }
}

async function assertJiraOrExtensionSender(sender) {
  if (isExtensionPageSender(sender)) {
    return;
  }

  await assertJiraSender(sender);
}

function isExtensionPageSender(sender) {
  const senderUrl = sender?.url || "";
  return (
    sender?.id === chrome.runtime.id &&
    senderUrl.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  );
}

function isJiraSenderForSettings(sender, settings) {
  if (sender?.id !== chrome.runtime.id || !settings?.jiraOrigin) {
    return false;
  }

  const candidateUrl = sender.url || sender.tab?.url;
  if (!candidateUrl) {
    return false;
  }

  try {
    const url = new URL(candidateUrl);
    return url.protocol === "https:" && url.origin === settings.jiraOrigin;
  } catch {
    return false;
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const savedSettings = stored[STORAGE_KEY] || {};
  const legacyJiraUrl = savedSettings.jiraBaseUrl || "";

  let jiraOrigin = savedSettings.jiraOrigin || "";
  if (!jiraOrigin && legacyJiraUrl) {
    try {
      jiraOrigin = normalizeJiraOrigin(legacyJiraUrl);
    } catch {
      jiraOrigin = "";
    }
  }

  return {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    jiraOrigin,
    projectName: String(savedSettings.projectName || ""),
    billable: savedSettings.billable === true,
    stopExisting: savedSettings.stopExisting !== false
  };
}

function toPublicSettings(settings, jiraPermissionGranted = false) {
  const togglConfigured = Boolean(settings.apiToken && settings.workspaceId);
  const jiraConfigured = Boolean(settings.jiraOrigin && jiraPermissionGranted);

  return {
    configured: togglConfigured && jiraConfigured,
    togglConfigured,
    jiraConfigured,
    jiraPermissionGranted: Boolean(jiraPermissionGranted),
    hasApiToken: Boolean(settings.apiToken),
    jiraOrigin: settings.jiraOrigin || "",
    workspaceId: settings.workspaceId,
    workspaceName: settings.workspaceName || "",
    profileName: settings.profileName || "",
    projectId: settings.projectId,
    projectName: settings.projectName || "",
    billable: settings.billable === true,
    descriptionTemplate: settings.descriptionTemplate,
    stopExisting: settings.stopExisting !== false
  };
}

async function getPublicSettings(settings) {
  const jiraPermissionGranted = await hasJiraHostPermission(settings.jiraOrigin);
  return toPublicSettings(settings, jiraPermissionGranted);
}

async function getOptionsState() {
  return getPublicSettings(await getSettings());
}

async function validateAndSaveSettings(input) {
  const existing = await getSettings();
  const candidate = input && typeof input === "object" ? input : {};
  const jiraOrigin = normalizeJiraOrigin(candidate.jiraOrigin);
  const apiToken = String(candidate.apiToken || "").trim() || existing.apiToken;

  if (!apiToken) {
    throw new UserFacingError("MISSING_API_TOKEN", "Enter your Toggl Track API token.");
  }

  if (!(await hasJiraHostPermission(jiraOrigin))) {
    throw new UserFacingError(
      "JIRA_PERMISSION_REQUIRED",
      `Grant this extension access to ${jiraOrigin} before saving.`
    );
  }

  const requestedWorkspaceId = normalizeOptionalPositiveInteger(
    candidate.workspaceId,
    "Workspace ID"
  );
  const projectId = normalizeOptionalPositiveInteger(candidate.projectId, "Project ID");
  const descriptionTemplate = normalizeTemplate(candidate.descriptionTemplate);
  const billable = candidate.billable === true;
  const stopExisting = candidate.stopExisting !== false;

  const me = await togglRequest("/api/v9/me", { apiToken });
  const workspaceId =
    requestedWorkspaceId ||
    normalizeOptionalPositiveInteger(me?.default_workspace_id, "Default workspace ID");

  if (!workspaceId) {
    throw new UserFacingError(
      "MISSING_WORKSPACE",
      "Toggl did not return a default workspace. Enter the Workspace ID under Advanced settings."
    );
  }

  const workspace = await togglRequest(`/api/v9/workspaces/${workspaceId}`, { apiToken });
  let projectName = "";

  if (projectId) {
    const project = await togglRequest(
      `/api/v9/workspaces/${workspaceId}/projects/${projectId}`,
      { apiToken }
    );
    projectName = String(project?.name || "");
  }

  const settings = {
    apiToken,
    jiraOrigin,
    workspaceId,
    workspaceName: String(workspace?.name || ""),
    profileName: String(me?.fullname || me?.email || ""),
    projectId,
    projectName,
    billable,
    descriptionTemplate,
    stopExisting
  };

  try {
    await upsertJiraContentScript(jiraOrigin);
  } catch {
    throw new UserFacingError(
      "JIRA_SCRIPT_REGISTRATION_FAILED",
      `The extension could not enable its Jira button on ${jiraOrigin}.`
    );
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: settings });

  if (existing.jiraOrigin && existing.jiraOrigin !== jiraOrigin) {
    await removeJiraHostPermission(existing.jiraOrigin);
  }

  return toPublicSettings(settings, true);
}

async function clearSettings() {
  const existing = await getSettings();

  await unregisterJiraContentScript().catch(() => undefined);
  await chrome.storage.local.remove(STORAGE_KEY);

  if (existing.jiraOrigin) {
    await removeJiraHostPermission(existing.jiraOrigin);
  }

  return { cleared: true };
}

async function getPopupState() {
  const settings = await getSettings();
  const publicSettings = await getPublicSettings(settings);

  if (!publicSettings.togglConfigured) {
    return { settings: publicSettings, current: null };
  }

  const current = await getCurrentTimeEntry(settings.apiToken);
  return {
    settings: publicSettings,
    current: sanitizeEntry(current)
  };
}

async function getTimerStatus(issueInput) {
  const issue = normalizeIssue(issueInput);
  const settings = await getSettings();
  const description = formatDescription(settings.descriptionTemplate, issue);
  const publicSettings = await getPublicSettings(settings);

  if (!publicSettings.configured) {
    return {
      configured: false,
      description,
      isCurrentIssue: false
    };
  }

  const current = await getCurrentTimeEntry(settings.apiToken);
  return {
    configured: true,
    description,
    isCurrentIssue: descriptionsMatch(current?.description, description)
  };
}

async function startTimer(issueInput) {
  const issue = normalizeIssue(issueInput);
  const settings = await getConfiguredTogglSettings();
  const description = formatDescription(settings.descriptionTemplate, issue);
  return startDescriptionTimer(description, settings);
}

async function startManualTimer(descriptionInput) {
  const settings = await getConfiguredTogglSettings();
  const description = normalizeManualDescription(descriptionInput);
  return startDescriptionTimer(description, settings);
}

async function startDescriptionTimer(description, settings) {
  const current = await getCurrentTimeEntry(settings.apiToken);

  if (current && descriptionsMatch(current.description, description)) {
    return {
      action: "already-running",
      description,
      stoppedPrevious: false,
      billable: current.billable === true,
      entry: sanitizeEntry(current)
    };
  }

  let stoppedPrevious = false;
  if (current) {
    if (!settings.stopExisting) {
      throw new UserFacingError(
        "CURRENT_TIMER_RUNNING",
        "Another timer is already running. Stop it in Toggl or enable automatic switching in Advanced settings."
      );
    }

    await stopTimeEntry(current, settings.apiToken);
    stoppedPrevious = true;
  }

  const body = {
    billable: settings.billable === true,
    created_with: CREATED_WITH,
    description,
    duration: -1,
    start: new Date().toISOString(),
    stop: null,
    workspace_id: settings.workspaceId
  };

  if (settings.projectId) {
    body.project_id = settings.projectId;
  }

  const created = await togglRequest(
    `/api/v9/workspaces/${settings.workspaceId}/time_entries`,
    {
      method: "POST",
      apiToken: settings.apiToken,
      body
    }
  );

  const entry = sanitizeEntry(created) ||
    sanitizeEntry(await getCurrentTimeEntry(settings.apiToken));

  return {
    action: "started",
    description,
    stoppedPrevious,
    billable: body.billable,
    entry
  };
}

async function stopTimerForIssue(issueInput) {
  const issue = normalizeIssue(issueInput);
  const settings = await getConfiguredTogglSettings();
  const description = formatDescription(settings.descriptionTemplate, issue);
  const current = await getCurrentTimeEntry(settings.apiToken);

  if (!current) {
    return { action: "nothing-running", description };
  }

  if (!descriptionsMatch(current.description, description)) {
    throw new UserFacingError(
      "DIFFERENT_TIMER_RUNNING",
      "A different timer is running. Use the extension popup to stop it."
    );
  }

  await stopTimeEntry(current, settings.apiToken);
  return {
    action: "stopped",
    description
  };
}

async function stopCurrentTimer() {
  const settings = await getConfiguredTogglSettings();
  const current = await getCurrentTimeEntry(settings.apiToken);

  if (!current) {
    return { action: "nothing-running" };
  }

  await stopTimeEntry(current, settings.apiToken);
  return { action: "stopped" };
}

async function getConfiguredTogglSettings() {
  const settings = await getSettings();

  if (!settings.apiToken || !settings.workspaceId) {
    throw new UserFacingError(
      "CONFIG_NOT_SET",
      "Configure your Toggl API token and workspace before starting a timer."
    );
  }

  return settings;
}

async function getCurrentTimeEntry(apiToken) {
  const entry = await togglRequest("/api/v9/me/time_entries/current", {
    apiToken,
    notFoundAsNull: true
  });

  if (!entry || typeof entry !== "object" || !entry.id) {
    return null;
  }

  return entry;
}

async function stopTimeEntry(entry, apiToken) {
  const workspaceId = normalizeOptionalPositiveInteger(
    entry.workspace_id || entry.wid,
    "Timer workspace ID"
  );
  const timeEntryId = normalizeOptionalPositiveInteger(entry.id, "Time entry ID");

  if (!workspaceId || !timeEntryId) {
    throw new UserFacingError(
      "INVALID_RUNNING_ENTRY",
      "Toggl returned a running timer without valid identifiers."
    );
  }

  return togglRequest(
    `/api/v9/workspaces/${workspaceId}/time_entries/${timeEntryId}/stop`,
    {
      method: "PATCH",
      apiToken
    }
  );
}

async function togglRequest(path, options = {}) {
  const { method = "GET", apiToken, body, notFoundAsNull = false } = options;

  if (!apiToken) {
    throw new UserFacingError("MISSING_API_TOKEN", "The Toggl API token is not configured.");
  }

  let response;
  try {
    response = await fetch(`${TOGGL_API_BASE_URL}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${btoa(`${apiToken}:api_token`)}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    throw new UserFacingError(
      "NETWORK_ERROR",
      "Could not connect to the Toggl Track API. Check your internet connection."
    );
  }

  const text = await response.text();
  const payload = parseResponseBody(text);

  if (notFoundAsNull && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw mapTogglError(response.status, payload);
  }

  return unwrapPayload(payload);
}

function parseResponseBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapPayload(payload) {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.prototype.hasOwnProperty.call(payload, "data")
  ) {
    return payload.data;
  }

  return payload;
}

function mapTogglError(status, payload) {
  const detail = truncate(extractApiError(payload), 180);

  if (status === 401 || status === 403) {
    return new UserFacingError(
      "TOGGL_AUTH_ERROR",
      "The token is invalid or does not have access to the selected workspace or project."
    );
  }

  if (status === 404) {
    return new UserFacingError(
      "TOGGL_NOT_FOUND",
      detail ? `Toggl resource not found: ${detail}` : "Toggl resource not found."
    );
  }

  if (status === 429) {
    return new UserFacingError(
      "TOGGL_RATE_LIMIT",
      "The Toggl API rate limit was reached. Try again shortly."
    );
  }

  if (status >= 500) {
    return new UserFacingError(
      "TOGGL_SERVER_ERROR",
      "The Toggl API is temporarily unavailable."
    );
  }

  return new UserFacingError(
    "TOGGL_API_ERROR",
    detail
      ? `Toggl rejected the operation: ${detail}`
      : `Toggl rejected the operation (HTTP ${status}).`
  );
}

function extractApiError(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(String).join(", ");
  }

  if (typeof payload === "object") {
    return String(payload.message || payload.error || payload.detail || "");
  }

  return "";
}

function normalizeIssue(input) {
  const key = String(input?.key || "").trim().toUpperCase();
  const summary = normalizeWhitespace(input?.summary || "");

  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
    throw new UserFacingError("INVALID_ISSUE_KEY", "Could not identify the Jira issue key.");
  }

  if (!summary) {
    throw new UserFacingError(
      "MISSING_ISSUE_SUMMARY",
      "Could not identify the Jira issue summary."
    );
  }

  if (summary.length > 1000) {
    throw new UserFacingError("ISSUE_SUMMARY_TOO_LONG", "The Jira issue summary is too long.");
  }

  const keyParts = key.match(/^(.+)-(\d+)$/);
  return {
    key,
    summary,
    url: normalizeIssueField(input?.url, 2048),
    projectKey: normalizeIssueField(input?.projectKey, 100) || keyParts?.[1] || "",
    projectName: normalizeIssueField(input?.projectName, 300),
    issueNumber: normalizeIssueField(input?.issueNumber, 50) || keyParts?.[2] || "",
    issueType: normalizeIssueField(input?.issueType, 200),
    status: normalizeIssueField(input?.status, 200),
    assignee: normalizeIssueField(input?.assignee, 300),
    reporter: normalizeIssueField(input?.reporter, 300),
    priority: normalizeIssueField(input?.priority, 200),
    parentKey: normalizeIssueField(input?.parentKey, 100),
    labels: normalizeIssueList(input?.labels, 500),
    components: normalizeIssueList(input?.components, 500)
  };
}

function normalizeIssueField(value, maxLength) {
  return truncate(normalizeWhitespace(value || ""), maxLength);
}

function normalizeIssueList(value, maxLength) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = list
    .map((item) => normalizeWhitespace(item || ""))
    .filter(Boolean)
    .join(", ");
  return truncate(normalized, maxLength);
}

function normalizeTemplate(value) {
  const template = String(value || DEFAULT_SETTINGS.descriptionTemplate).trim();

  if (!template) {
    return DEFAULT_SETTINGS.descriptionTemplate;
  }

  if (template.length > 300) {
    throw new UserFacingError(
      "TEMPLATE_TOO_LONG",
      "The description template can contain at most 300 characters."
    );
  }

  const unknownVariables = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map((match) => match[1])
    .filter((name) => !ISSUE_TEMPLATE_VARIABLE_SET.has(name));

  if (unknownVariables.length > 0) {
    const names = [...new Set(unknownVariables)].map((name) => `{${name}}`).join(", ");
    throw new UserFacingError(
      "UNKNOWN_TEMPLATE_VARIABLE",
      `Unknown description variable${unknownVariables.length > 1 ? "s" : ""}: ${names}.`
    );
  }

  return template;
}

function formatDescription(template, issue) {
  const normalizedIssue = normalizeIssue(issue);
  let rendered = normalizeTemplate(template);

  for (const variable of ISSUE_TEMPLATE_VARIABLES) {
    rendered = rendered.replaceAll(`{${variable}}`, normalizedIssue[variable] || "");
  }

  rendered = normalizeWhitespace(rendered);
  if (!rendered) {
    throw new UserFacingError(
      "EMPTY_DESCRIPTION",
      "The description template produced an empty value."
    );
  }

  return truncate(rendered, 1000);
}

function normalizeManualDescription(value) {
  const description = normalizeWhitespace(value || "");

  if (!description) {
    throw new UserFacingError(
      "MISSING_MANUAL_DESCRIPTION",
      "Enter a description before starting the timer."
    );
  }

  if (description.length > 1000) {
    throw new UserFacingError(
      "MANUAL_DESCRIPTION_TOO_LONG",
      "The timer description can contain at most 1000 characters."
    );
  }

  return description;
}

function normalizeJiraOrigin(value) {
  let rawValue = String(value || "").trim();

  if (!rawValue) {
    throw new UserFacingError("MISSING_JIRA_URL", "Enter your Jira site URL.");
  }

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(rawValue)) {
    rawValue = `https://${rawValue}`;
  }

  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new UserFacingError(
      "INVALID_JIRA_URL",
      "Enter a valid Jira URL, such as https://your-company.atlassian.net."
    );
  }

  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new UserFacingError(
      "INVALID_JIRA_URL",
      "The Jira site must use a valid HTTPS URL without embedded credentials."
    );
  }

  return url.origin;
}

function toJiraMatchPattern(jiraOrigin) {
  const url = new URL(jiraOrigin);
  return `${url.protocol}//${url.host}/*`;
}

async function hasJiraHostPermission(jiraOrigin) {
  if (!jiraOrigin) {
    return false;
  }

  try {
    return await chrome.permissions.contains({
      origins: [toJiraMatchPattern(jiraOrigin)]
    });
  } catch {
    return false;
  }
}

async function removeJiraHostPermission(jiraOrigin) {
  if (!jiraOrigin) {
    return false;
  }

  try {
    return await chrome.permissions.remove({
      origins: [toJiraMatchPattern(jiraOrigin)]
    });
  } catch {
    return false;
  }
}

async function upsertJiraContentScript(jiraOrigin) {
  const script = {
    id: DYNAMIC_CONTENT_SCRIPT_ID,
    matches: [toJiraMatchPattern(jiraOrigin)],
    js: ["content.js"],
    allFrames: false,
    persistAcrossSessions: true,
    runAt: "document_idle",
    world: "ISOLATED"
  };

  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [DYNAMIC_CONTENT_SCRIPT_ID]
  });

  if (registered.length > 0) {
    await chrome.scripting.updateContentScripts([script]);
    return;
  }

  await chrome.scripting.registerContentScripts([script]);
}

async function unregisterJiraContentScript() {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [DYNAMIC_CONTENT_SCRIPT_ID]
  });

  if (registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({
      ids: [DYNAMIC_CONTENT_SCRIPT_ID]
    });
  }
}

async function syncJiraContentScript(settings = null) {
  const resolvedSettings = settings || (await getSettings());
  const canRunOnJira =
    Boolean(resolvedSettings.jiraOrigin) &&
    (await hasJiraHostPermission(resolvedSettings.jiraOrigin));

  if (!canRunOnJira) {
    await unregisterJiraContentScript();
    return;
  }

  await upsertJiraContentScript(resolvedSettings.jiraOrigin);
}

function scheduleContentScriptSync() {
  void syncJiraContentScript().catch((error) => {
    console.error("Could not synchronize the Jira content script.", error);
  });
}

function normalizeOptionalPositiveInteger(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new UserFacingError("INVALID_ID", `${fieldName} must be a positive integer.`);
  }

  return number;
}

function descriptionsMatch(first, second) {
  return normalizeWhitespace(first || "") === normalizeWhitespace(second || "");
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.id) {
    return null;
  }

  return {
    id: Number(entry.id),
    description: String(entry.description || ""),
    billable: entry.billable === true,
    start: entry.start ? String(entry.start) : null,
    stop: entry.stop ? String(entry.stop) : null,
    duration: Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : null,
    workspaceId: Number(entry.workspace_id || entry.wid || 0) || null,
    projectId: Number(entry.project_id || entry.pid || 0) || null
  };
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function serializeError(error) {
  if (error instanceof UserFacingError) {
    return { code: error.code, message: error.message };
  }

  console.error("Unexpected Jira → Toggl extension error.", error);
  return {
    code: "UNEXPECTED_ERROR",
    message: "An unexpected extension error occurred."
  };
}
