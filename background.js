"use strict";

const STORAGE_KEY = "jiraTogglSettings";
const WORKLOG_STATE_KEY = "jiraTogglWorklogState";
const DYNAMIC_CONTENT_SCRIPT_ID = "jira-toggl-quick-start-content";
const TOGGL_API_BASE_URL = "https://api.track.toggl.com";
const TOGGL_ACCOUNTS_URL = "https://accounts.toggl.com/api/sessions";
const TOGGL_ACCOUNTS_MATCH = "https://accounts.toggl.com/*";
const TOGGL_LOGIN_URL = "https://accounts.toggl.com/track/login/";
const TOGGL_TRACK_WEB_MATCH = "https://track.toggl.com/*";
const TOGGL_TRACK_WEB_ME_URL = "https://track.toggl.com/api/v9/me";
const TOGGL_TRACK_WEB_URL = "https://track.toggl.com/timer";
const TOGGL_CONNECTION_MATCHES = [TOGGL_ACCOUNTS_MATCH, TOGGL_TRACK_WEB_MATCH];
const CREATED_WITH = "jira-toggl-quickstart-chrome";
const WORKLOG_PROPERTY_KEY = "jira-toggl-quickstart";
const WORKLOG_STATE_VERSION = 1;
const MAX_WORKLOG_RECORDS = 200;
const MIN_PLAUSIBLE_UNIX_SECONDS = 1_000_000_000;
const WORKLOG_RECONCILE_LIMIT = 5;
const WORKLOG_API_VERSIONS = Object.freeze(["3", "2", "latest"]);
const DEFAULT_ACTION_ICON_PATHS = Object.freeze({
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png"
});
const RUNNING_ACTION_ICON_PATHS = Object.freeze({
  16: "icons/icon-running16.png",
  32: "icons/icon-running32.png",
  48: "icons/icon-running48.png",
  128: "icons/icon-running128.png"
});
const JIRA_ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9_]*-\d+)\b/i;
const JIRA_PROGRESS_FIELDS = Object.freeze([
  "summary",
  "timetracking",
  "timespent",
  "timeoriginalestimate",
  "timeestimate"
]);
const JIRA_CLIPBOARD_FIELDS = Object.freeze(["summary", "description"]);
const FLOATING_BUTTON_POSITIONS = Object.freeze([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
]);
const FLOATING_BUTTON_POSITION_SET = new Set(FLOATING_BUTTON_POSITIONS);

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
const WORKLOG_COMMENT_VARIABLES = Object.freeze([
  "description",
  "issueKey",
  "togglId"
]);
const WORKLOG_COMMENT_VARIABLE_SET = new Set(WORKLOG_COMMENT_VARIABLES);

const DEFAULT_SETTINGS = Object.freeze({
  apiToken: "",
  togglUserId: null,
  jiraOrigin: "",
  workspaceId: null,
  workspaceName: "",
  profileName: "",
  projectId: null,
  projectName: "",
  billable: false,
  descriptionTemplate: "[{key}] {summary}",
  stopExisting: true,
  syncWorklogs: false,
  worklogSyncMode: "automatic",
  worklogRounding: "nearest-minute",
  worklogCommentTemplate: "Synced from Toggl: {description}",
  floatingButtonPosition: "bottom-right"
});

const worklogSyncLocks = new Map();
let extensionMutationQueue = Promise.resolve();
let actionIconRevision = 0;

class UserFacingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UserFacingError";
    this.code = code;
  }
}

// The API token remains available only to trusted extension pages and the
// service worker. Jira content scripts cannot read chrome.storage.local.
const trustedStorageReady = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS"
});
void trustedStorageReady.catch(() => undefined);

void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Could not configure the side panel.", error));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void initializeExtension(reason);
});

chrome.runtime.onStartup.addListener(() => {
  scheduleContentScriptSync();
  scheduleActionIconSync();
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
    scheduleActionIconSync(settings);

    if (
      reason === "install" ||
      !settings.jiraOrigin ||
      !hasStartConfiguration(settings)
    ) {
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
    case "GET_TIMER_STATUS": {
      const settings = await assertJiraOrExtensionSender(sender);
      return getTimerStatus(message.issue, settings);
    }

    case "START_TIMER":
      return notifySidePanelAfter(serializeExtensionMutation(async () => {
        const settings = await assertJiraSender(sender);
        return startTimer(message.issue, settings);
      }));

    case "START_MANUAL_TIMER":
      assertExtensionPageSender(sender);
      return notifySidePanelAfter(serializeExtensionMutation(
        () => startManualTimer(message.description)
      ));

    case "START_TODAY_APPOINTMENT":
      assertExtensionPageSender(sender);
      return notifySidePanelAfter(serializeExtensionMutation(
        () => startTodayAppointment(message.sourceEntryId)
      ));

    case "STOP_TIMER":
      return notifySidePanelAfter(serializeExtensionMutation(async () => {
        const settings = await assertJiraSender(sender);
        return stopTimerForIssue(message.issue, settings);
      }));

    case "GET_POPUP_STATE":
      assertExtensionPageSender(sender);
      return getPopupState();

    case "STOP_CURRENT_TIMER":
      assertExtensionPageSender(sender);
      return notifySidePanelAfter(serializeExtensionMutation(
        () => stopCurrentTimer()
      ));

    case "SYNC_PENDING_WORKLOGS":
      assertExtensionPageSender(sender);
      return notifySidePanelAfter(serializeExtensionMutation(
        () => syncPendingWorklogs()
      ));

    case "GET_OPTIONS_STATE":
      assertExtensionPageSender(sender);
      return getOptionsState();

    case "CONNECT_TOGGL":
      assertExtensionPageSender(sender);
      return notifySidePanelAfter(serializeExtensionMutation(() => connectToggl()));

    case "GET_JIRA_UI_SETTINGS": {
      const settings = await assertJiraSender(sender);
      return getJiraUiSettings(settings);
    }

    case "GET_JIRA_CLIPBOARD": {
      const settings = await assertJiraSender(sender);
      return getJiraClipboard(message.issueKey, settings);
    }

    case "VALIDATE_AND_SAVE_SETTINGS":
      assertExtensionPageSender(sender);
      return notifySidePanelAfter(serializeExtensionMutation(
        () => validateAndSaveSettings(message.settings)
      ));

    case "CLEAR_SETTINGS":
      assertExtensionPageSender(sender);
      return notifySidePanelAfter(serializeExtensionMutation(() => clearSettings()));

    case "OPEN_OPTIONS":
      await assertJiraOrExtensionSender(sender);
      await chrome.runtime.openOptionsPage();
      return { opened: true };

    default:
      throw new UserFacingError("UNKNOWN_MESSAGE", "Unknown extension action.");
  }
}

async function notifySidePanelAfter(operation) {
  try {
    return await operation;
  } finally {
    void chrome.runtime
      .sendMessage({ type: "SIDE_PANEL_STATE_CHANGED" })
      .catch(() => undefined);
  }
}

function serializeExtensionMutation(operation) {
  const queued = extensionMutationQueue
    .catch(() => undefined)
    .then(operation);
  extensionMutationQueue = queued;
  return queued;
}

async function assertJiraSender(sender) {
  const settings = await getSettings();

  if (!isJiraSenderForSettings(sender, settings)) {
    throw new UserFacingError(
      "UNTRUSTED_SENDER",
      "This page is not the authorized Jira site."
    );
  }

  return settings;
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
    return null;
  }

  return assertJiraSender(sender);
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
    stopExisting: savedSettings.stopExisting !== false,
    syncWorklogs: savedSettings.syncWorklogs === true,
    worklogSyncMode: coerceWorklogSyncMode(savedSettings.worklogSyncMode),
    worklogRounding: coerceWorklogRounding(savedSettings.worklogRounding),
    worklogCommentTemplate: coerceWorklogCommentTemplate(
      savedSettings.worklogCommentTemplate
    ),
    floatingButtonPosition: coerceFloatingButtonPosition(
      savedSettings.floatingButtonPosition
    )
  };
}

function toPublicSettings(settings, jiraPermissionGranted = false) {
  const hasApiToken = Boolean(settings.apiToken);
  const workspaceConfigured = isPositiveInteger(settings.workspaceId);
  const projectConfigured = isPositiveInteger(settings.projectId);
  const togglConnected = hasApiToken;
  const togglConfigured = togglConnected && workspaceConfigured;
  const jiraConfigured = Boolean(settings.jiraOrigin && jiraPermissionGranted);

  let configurationRequired = "";
  if (!hasApiToken) {
    configurationRequired = "toggl";
  } else if (!workspaceConfigured) {
    configurationRequired = "workspace";
  } else if (!jiraConfigured) {
    configurationRequired = "jira";
  }

  return {
    configured: togglConfigured && jiraConfigured,
    togglConfigured,
    togglConnected,
    workspaceConfigured,
    projectConfigured,
    canAccessTimers: hasApiToken,
    configurationRequired,
    jiraConfigured,
    jiraPermissionGranted: Boolean(jiraPermissionGranted),
    hasApiToken,
    jiraOrigin: settings.jiraOrigin || "",
    workspaceId: settings.workspaceId,
    workspaceName: settings.workspaceName || "",
    profileName: settings.profileName || "",
    projectId: settings.projectId,
    projectName: settings.projectName || "",
    billable: settings.billable === true,
    descriptionTemplate: settings.descriptionTemplate,
    stopExisting: settings.stopExisting !== false,
    syncWorklogs: settings.syncWorklogs === true,
    worklogSyncMode: settings.worklogSyncMode,
    worklogRounding: settings.worklogRounding,
    worklogCommentTemplate: settings.worklogCommentTemplate,
    floatingButtonPosition: settings.floatingButtonPosition
  };
}

async function getPublicSettings(settings) {
  const jiraPermissionGranted = await hasJiraHostPermission(settings.jiraOrigin);
  return toPublicSettings(settings, jiraPermissionGranted);
}

async function getOptionsState() {
  const settings = await getSettings();
  const publicSettings = await getPublicSettings(settings);
  const worklogs = await getWorklogSummary(settings);
  return {
    ...publicSettings,
    pendingWorklogCount: worklogs.pendingCount
  };
}

async function connectToggl() {
  if (!(await hasTogglConnectionPermissions())) {
    throw new UserFacingError(
      "TOGGL_ACCOUNTS_PERMISSION_REQUIRED",
      "Grant access to Toggl Accounts and Track before connecting."
    );
  }

  await assertTrustedStorageReady();
  const apiToken = await getTogglSessionApiToken();
  const me = await validateConnectedTogglProfile(apiToken);
  const existing = await resolveExistingTogglIdentity(
    await getSettings(),
    apiToken,
    me
  );
  const settings = buildConnectedTogglSettings(existing, apiToken, me);
  await assertTogglAccountSwitchSafe(existing, settings);
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  await syncActionIcon(settings);
  return getOptionsState();
}

async function validateConnectedTogglProfile(apiToken) {
  try {
    return await togglRequest("/api/v9/me", { apiToken });
  } catch {
    throw new UserFacingError(
      "TOGGL_CONNECTION_VALIDATION_FAILED",
      "Toggl could not validate this account connection. The previous connection was not changed."
    );
  }
}

async function assertTrustedStorageReady() {
  try {
    await trustedStorageReady;
  } catch {
    throw new UserFacingError(
      "PROTECTED_STORAGE_UNAVAILABLE",
      "Chrome could not protect the saved Toggl connection. Reload the extension and try again."
    );
  }
}

async function getTogglSessionApiToken() {
  const { response, payload } = await fetchTogglAccountSession();
  await assertUsableTogglSessionResponse(response);
  assertSuccessfulTogglSession(payload);
  return getTogglWebApiToken();
}

async function assertUsableTogglSessionResponse(response) {
  if (response.status === 401 || response.status === 403) {
    const opened = await openTogglLogin();
    throw new UserFacingError(
      "TOGGL_LOGIN_REQUIRED",
      opened
        ? "Log in to Toggl in the opened tab, then click Connect Toggl again."
        : "Open the Toggl login page, sign in, then click Connect Toggl again."
    );
  }

  if (!response.ok) {
    throw new UserFacingError(
      "TOGGL_SESSION_UNAVAILABLE",
      "Toggl Accounts could not check your session. Try again shortly."
    );
  }
}

function assertSuccessfulTogglSession(payload) {
  if (unwrapPayload(payload)?.success !== true) {
    throw new UserFacingError(
      "TOGGL_SESSION_UNSUPPORTED",
      "Toggl returned an unsupported account session response. The connection flow may have changed."
    );
  }
}

async function getTogglWebApiToken() {
  const { response, payload } = await fetchTogglWebProfile();
  await assertUsableTogglWebResponse(response);
  const profile = unwrapPayload(payload);
  const apiToken = typeof profile?.api_token === "string"
    ? profile.api_token.trim()
    : "";
  if (!apiToken) {
    throw new UserFacingError(
      "TOGGL_TRACK_PROFILE_UNSUPPORTED",
      "Toggl did not return a usable Track profile. The connection flow may have changed."
    );
  }

  return apiToken;
}

async function assertUsableTogglWebResponse(response) {
  if (response.status === 401 || response.status === 403) {
    const opened = await openTogglPage(TOGGL_TRACK_WEB_URL);
    throw new UserFacingError(
      "TOGGL_TRACK_SESSION_REQUIRED",
      opened
        ? "Finish opening Toggl Track in the new tab, then retry the connection."
        : "Open Toggl Track in this Chrome profile, then retry the connection."
    );
  }

  if (!response.ok) {
    throw new UserFacingError(
      "TOGGL_TRACK_SESSION_UNAVAILABLE",
      "Toggl Track could not load your signed-in profile. Try again shortly."
    );
  }
}

async function fetchTogglAccountSession() {
  try {
    const response = await fetch(TOGGL_ACCOUNTS_URL, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" }
    });
    const payload = parseResponseBody(await response.text());
    return { response, payload };
  } catch {
    throw new UserFacingError(
      "TOGGL_SESSION_UNAVAILABLE",
      "Could not connect to Toggl Accounts. Check your connection and browser cookie settings."
    );
  }
}

async function fetchTogglWebProfile() {
  try {
    const response = await fetch(TOGGL_TRACK_WEB_ME_URL, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" }
    });
    const payload = parseResponseBody(await response.text());
    return { response, payload };
  } catch {
    throw new UserFacingError(
      "TOGGL_TRACK_SESSION_UNAVAILABLE",
      "Could not connect to Toggl Track. Check your connection and browser cookie settings."
    );
  }
}

async function openTogglLogin() {
  return openTogglPage(TOGGL_LOGIN_URL);
}

async function openTogglPage(url) {
  try {
    await chrome.tabs.create({ url });
    return true;
  } catch {
    return false;
  }
}

function buildConnectedTogglSettings(existing, apiToken, me) {
  const togglUserId = getValidatedTogglUserId(me);
  const defaultWorkspaceId = normalizeOptionalPositiveInteger(
    me?.default_workspace_id,
    "Default workspace ID"
  );
  const sameUser = Number(existing.togglUserId) === togglUserId;
  const workspaceId = sameUser && isPositiveInteger(existing.workspaceId)
    ? Number(existing.workspaceId)
    : defaultWorkspaceId;
  return {
    ...existing,
    apiToken,
    togglUserId,
    workspaceId,
    workspaceName: sameUser ? existing.workspaceName : "",
    profileName: String(me?.fullname || me?.email || ""),
    projectId: sameUser ? existing.projectId : null,
    projectName: sameUser ? existing.projectName : ""
  };
}

async function resolveExistingTogglIdentity(existing, apiToken, me) {
  if (!existing.apiToken || isPositiveInteger(existing.togglUserId)) {
    return existing;
  }

  if (existing.apiToken === apiToken) {
    return { ...existing, togglUserId: getValidatedTogglUserId(me) };
  }

  try {
    const oldMe = await togglRequest("/api/v9/me", { apiToken: existing.apiToken });
    return { ...existing, togglUserId: getValidatedTogglUserId(oldMe) };
  } catch {
    throw new UserFacingError(
      "TOGGL_ACCOUNT_SWITCH_UNVERIFIED",
      "The previous Toggl account could not be verified. Remove settings before connecting a different user."
    );
  }
}

function getValidatedTogglUserId(me) {
  const togglUserId = Number(me?.id);
  if (!isPositiveInteger(togglUserId)) {
    throw new UserFacingError(
      "TOGGL_PROFILE_INVALID",
      "Toggl did not return a valid account profile. The connection was not saved."
    );
  }
  return togglUserId;
}

async function assertTogglAccountSwitchSafe(existing, settings) {
  const switchedUser = isPositiveInteger(existing.togglUserId) &&
    Number(existing.togglUserId) !== settings.togglUserId;
  if (!switchedUser) {
    return;
  }

  await assertNoRunningTimerForAccountSwitch(existing.apiToken);
  await assertNoRetainedWorklogState();
}

async function assertNoRetainedWorklogState() {
  const worklogs = await getWorklogState();
  if (Object.keys(worklogs.entries).length > 0) {
    throw new UserFacingError(
      "TOGGL_ACCOUNT_SWITCH_REQUIRES_CLEAR",
      "Remove settings before connecting a different Toggl user because Jira-linked timer or Work Log history is still saved."
    );
  }
}

async function assertNoRunningTimerForAccountSwitch(apiToken) {
  let current;
  try {
    current = await getCurrentTimeEntry(apiToken);
  } catch {
    throw new UserFacingError(
      "TOGGL_ACCOUNT_SWITCH_UNVERIFIED",
      "The extension could not verify whether the previous Toggl account has a running timer. Stop it or remove settings before switching accounts."
    );
  }

  if (current) {
    throw new UserFacingError(
      "TOGGL_ACCOUNT_SWITCH_TIMER_RUNNING",
      "Stop the running timer in the previous Toggl account before connecting a different user."
    );
  }
}

async function getJiraUiSettings(settingsInput = null) {
  const settings = settingsInput || await getSettings();
  return {
    floatingButtonPosition: settings.floatingButtonPosition
  };
}

async function validateAndSaveSettings(input) {
  const existing = await getSettings();
  const candidate = input && typeof input === "object" ? input : {};
  const jiraOrigin = normalizeJiraOrigin(candidate.jiraOrigin);
  const apiToken = existing.apiToken;

  if (!apiToken) {
    throw new UserFacingError("MISSING_API_TOKEN", "Connect Toggl before saving settings.");
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
  const requestedProjectId = normalizeOptionalPositiveInteger(
    candidate.projectId,
    "Toggl project ID"
  );
  const descriptionTemplate = normalizeTemplate(candidate.descriptionTemplate);
  const billable = candidate.billable === true;
  const stopExisting = candidate.stopExisting !== false;
  const syncWorklogs = candidate.syncWorklogs === true;
  const worklogSyncMode = normalizeWorklogSyncMode(candidate.worklogSyncMode);
  const worklogRounding = normalizeWorklogRounding(candidate.worklogRounding);
  const worklogCommentTemplate = normalizeWorklogCommentTemplate(
    candidate.worklogCommentTemplate
  );
  const floatingButtonPosition = normalizeFloatingButtonPosition(
    candidate.floatingButtonPosition
  );

  const me = await togglRequest("/api/v9/me?with_related_data=true", { apiToken });
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
  let project = null;
  let projectId = requestedProjectId;

  if (requestedProjectId) {
    project = await togglRequest(
      `/api/v9/workspaces/${workspaceId}/projects/${requestedProjectId}`,
      { apiToken }
    );
    validateSelectedProject(project, requestedProjectId, workspaceId);
  } else {
    project = selectAutomaticProject(getRelatedProjects(me), workspaceId);
    projectId = project ? Number(project.id) : null;
  }

  const projectName = project ? String(project.name || "").trim() : "";
  if (project && !projectName) {
    throw new UserFacingError(
      "TOGGL_PROJECT_INVALID",
      "Toggl did not return a valid name for the selected project."
    );
  }

  const settings = {
    apiToken,
    togglUserId: existing.togglUserId,
    jiraOrigin,
    workspaceId,
    workspaceName: String(workspace?.name || ""),
    profileName: String(me?.fullname || me?.email || ""),
    projectId,
    projectName,
    billable,
    descriptionTemplate,
    stopExisting,
    syncWorklogs,
    worklogSyncMode,
    worklogRounding,
    worklogCommentTemplate,
    floatingButtonPosition
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
  await setActionIcon(false);
  await syncActionIcon(settings);

  if (existing.jiraOrigin && existing.jiraOrigin !== jiraOrigin) {
    await clearWorklogState();
    await removeJiraHostPermission(existing.jiraOrigin);
  }

  return toPublicSettings(settings, true);
}

function getRelatedProjects(me) {
  const projects = [
    ...(Array.isArray(me?.projects) ? me.projects : [])
  ];

  for (const workspace of Array.isArray(me?.workspaces) ? me.workspaces : []) {
    projects.push(...(Array.isArray(workspace?.projects) ? workspace.projects : []));
  }

  return projects;
}

function getProjectWorkspaceId(project) {
  const value = Number(
    project?.workspace_id || project?.workspaceId || project?.wid || 0
  );
  return isPositiveInteger(value) ? value : null;
}

function selectAutomaticProject(projects, workspaceId) {
  let selected = null;
  let highestActualHours = -Infinity;

  for (const project of Array.isArray(projects) ? projects : []) {
    if (
      project?.active !== true ||
      !isPositiveInteger(project?.id) ||
      !String(project?.name || "").trim() ||
      getProjectWorkspaceId(project) !== workspaceId
    ) {
      continue;
    }

    const actualHours = Number(project.actual_hours);
    const score = Number.isFinite(actualHours) && actualHours >= 0 ? actualHours : 0;
    if (!selected || score > highestActualHours) {
      selected = project;
      highestActualHours = score;
    }
  }

  return selected;
}

function validateSelectedProject(project, requestedProjectId, workspaceId) {
  const returnedProjectId = Number(project?.id || 0);
  const projectWorkspaceId = getProjectWorkspaceId(project);

  if (returnedProjectId !== requestedProjectId) {
    throw new UserFacingError(
      "TOGGL_PROJECT_MISMATCH",
      "Toggl returned a different project than the one requested. Check the project ID."
    );
  }

  if (projectWorkspaceId && projectWorkspaceId !== workspaceId) {
    throw new UserFacingError(
      "TOGGL_PROJECT_WORKSPACE_MISMATCH",
      "The Toggl project does not belong to the selected workspace."
    );
  }

  if (!String(project?.name || "").trim()) {
    throw new UserFacingError(
      "TOGGL_PROJECT_INVALID",
      "Toggl did not return a valid project for that workspace and project ID."
    );
  }
}

async function clearSettings() {
  const existing = await getSettings();

  await unregisterJiraContentScript().catch(() => undefined);
  await chrome.storage.local.remove([STORAGE_KEY, WORKLOG_STATE_KEY]);
  await setActionIcon(false);

  const jiraAccessRemoved = existing.jiraOrigin
    ? await removeJiraHostPermission(existing.jiraOrigin)
    : true;
  const togglAccessRemoved = await removeTogglConnectionPermissions();
  const siteAccessRemoved = jiraAccessRemoved && togglAccessRemoved;

  return {
    cleared: true,
    permissionCleanupWarning: siteAccessRemoved
      ? ""
      : "Settings were removed, but Chrome could not remove site access. Remove it from the extension's site settings."
  };
}

async function getPopupState() {
  const settings = await getSettings();
  const publicSettings = await getPublicSettings(settings);

  if (!settings.apiToken) {
    return {
      settings: publicSettings,
      current: null,
      workedToday: {
        status: "not-configured",
        totalSeconds: null,
        weekTotalSeconds: null,
        message: "Connect Toggl to load your time totals."
      },
      jira: { status: "not-applicable" },
      worklogs: await getWorklogSummary(settings)
    };
  }

  const current = await getCurrentTimeEntry(settings.apiToken);
  await serializeExtensionMutation(async () => {
    const latestSettings = await getSettings();
    if (latestSettings.apiToken !== settings.apiToken) {
      return;
    }
    await reconcileStoppedTrackedTimers(latestSettings, current?.id);
  }).catch(() => undefined);

  const [workedToday, jira] = await Promise.all([
    getWorkedTodaySummary(settings.apiToken, current, undefined, settings),
    getCurrentJiraInsight(current, settings, publicSettings)
  ]);

  return {
    settings: publicSettings,
    current: sanitizeEntry(current),
    workedToday,
    jira,
    worklogs: await getWorklogSummary(settings)
  };
}

async function getTimerStatus(issueInput, settingsInput = null) {
  const issue = normalizeIssue(issueInput);
  const settings = settingsInput || await getSettings();
  const description = formatDescription(settings.descriptionTemplate, issue);
  const publicSettings = await getPublicSettings(settings);

  const current = settings.apiToken
    ? await getCurrentTimeEntry(settings.apiToken)
    : null;

  return {
    configured: publicSettings.configured,
    canStart: publicSettings.configured,
    configurationRequired: publicSettings.configurationRequired,
    description,
    isCurrentIssue: descriptionsMatch(current?.description, description)
  };
}

async function startTimer(issueInput, settingsInput = null) {
  const issue = normalizeIssue(issueInput);
  const settings = await getConfiguredTogglSettings(settingsInput);
  const description = formatDescription(settings.descriptionTemplate, issue);
  return startDescriptionTimer(description, settings, issue);
}

async function startManualTimer(descriptionInput) {
  const settings = await getConfiguredTogglSettings();
  const description = normalizeManualDescription(descriptionInput);
  return startDescriptionTimer(description, settings, null);
}

async function startTodayAppointment(sourceEntryIdInput) {
  const settings = await getConfiguredTogglSettings();
  const sourceEntryId = normalizeAppointmentSourceId(sourceEntryIdInput);
  const source = await getTimeEntryById(sourceEntryId, settings.apiToken);
  validateTodayAppointmentSource(source, sourceEntryId);

  const description = normalizeManualDescription(source.description);
  const state = await getWorklogState();
  const issueKey = getAssociatedIssueKey(sourceEntryId, state, settings.jiraOrigin);
  return startDescriptionTimer(
    description,
    settings,
    issueKey,
    { forceSwitch: true }
  );
}

async function startDescriptionTimer(
  description,
  settings,
  issue = null,
  { forceSwitch = false } = {}
) {
  const current = await getCurrentTimeEntry(settings.apiToken);

  if (current && !forceSwitch && descriptionsMatch(current.description, description)) {
    const entry = sanitizeEntry(current);
    if (issue && entry) {
      await trackJiraTimer(entry, issue, description, settings);
    }

    return {
      action: "already-running",
      description,
      stoppedPrevious: false,
      billable: current.billable === true,
      entry
    };
  }

  let stoppedPrevious = false;
  let previousWorklogSync = null;
  if (current) {
    if (!forceSwitch && !settings.stopExisting) {
      throw new UserFacingError(
        "CURRENT_TIMER_RUNNING",
        "Another timer is already running. Stop it in Toggl or enable automatic switching in Advanced settings."
      );
    }

    const stopped = await stopTrackedTimeEntry(current, settings);
    stoppedPrevious = true;
    previousWorklogSync = stopped.worklogSync;
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

  if (isPositiveInteger(settings.projectId)) {
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
  await setActionIcon(Boolean(entry));

  if (issue && entry) {
    await trackJiraTimer(entry, issue, description, settings);
  }

  return {
    action: "started",
    description,
    stoppedPrevious,
    previousWorklogSync,
    billable: body.billable,
    entry
  };
}

async function stopTimerForIssue(issueInput, settingsInput = null) {
  const issue = normalizeIssue(issueInput);
  const settings = await getTogglAccessSettings(settingsInput);
  const description = formatDescription(settings.descriptionTemplate, issue);
  const current = await getCurrentTimeEntry(settings.apiToken);

  if (!current) {
    return { action: "nothing-running", description };
  }

  if (!descriptionsMatch(current.description, description)) {
    throw new UserFacingError(
      "DIFFERENT_TIMER_RUNNING",
      "A different timer is running. Use the extension side panel to stop it."
    );
  }

  const stopped = await stopTrackedTimeEntry(current, settings, issue);
  return {
    action: "stopped",
    description,
    entry: stopped.entry,
    worklogSync: stopped.worklogSync
  };
}

async function stopCurrentTimer() {
  const settings = await getTogglAccessSettings();
  const current = await getCurrentTimeEntry(settings.apiToken);

  if (!current) {
    return {
      action: "nothing-running",
      worklogs: await getWorklogSummary(settings)
    };
  }

  const stopped = await stopTrackedTimeEntry(current, settings);
  return {
    action: "stopped",
    entry: stopped.entry,
    worklogSync: stopped.worklogSync,
    worklogs: await getWorklogSummary(settings)
  };
}

async function getConfiguredTogglSettings(settingsInput = null) {
  const settings = settingsInput || await getSettings();

  if (!hasStartConfiguration(settings)) {
    throw new UserFacingError(
      "CONFIG_NOT_SET",
      "Configure your Toggl API token and workspace before starting a timer."
    );
  }

  return settings;
}

async function getTogglAccessSettings(settingsInput = null) {
  const settings = settingsInput || await getSettings();

  if (!settings.apiToken) {
    throw new UserFacingError(
      "CONFIG_NOT_SET",
      "Configure your Toggl API token before accessing timers."
    );
  }

  return settings;
}

async function setActionIcon(running, revision = null) {
  const updateRevision = revision ?? ++actionIconRevision;
  if (updateRevision !== actionIconRevision) {
    return;
  }

  const path = running
    ? RUNNING_ACTION_ICON_PATHS
    : DEFAULT_ACTION_ICON_PATHS;

  try {
    await chrome.action.setIcon({ path });
  } catch (error) {
    console.error("Could not update the Jira → Toggl toolbar icon.", error);
  }
}

async function syncActionIcon(settingsInput = null) {
  const settings = settingsInput || (await getSettings());
  if (!settings.apiToken) {
    await setActionIcon(false);
    return;
  }

  await getCurrentTimeEntry(settings.apiToken).catch(() => undefined);
}

function scheduleActionIconSync(settings = null) {
  void syncActionIcon(settings).catch((error) => {
    console.error("Could not synchronize the Jira → Toggl toolbar icon.", error);
  });
}

async function getCurrentTimeEntry(apiToken) {
  const iconRevision = ++actionIconRevision;
  const entry = await togglRequest("/api/v9/me/time_entries/current", {
    apiToken,
    notFoundAsNull: true
  });

  const current = entry && typeof entry === "object" && entry.id
    ? entry
    : null;
  await setActionIcon(Boolean(current), iconRevision);
  return current;
}

async function getWorkedTodaySummary(
  apiToken,
  currentEntry,
  nowInput = new Date(),
  settings = null
) {
  const interval = getLocalDayInterval(nowInput);

  try {
    const worklogStatePromise = settings
      ? getWorklogState().catch(() => ({ entries: {} }))
      : Promise.resolve({ entries: {} });
    const [entries, worklogState] = await Promise.all([
      togglRequest(
        `/api/v9/me/time_entries?start_date=${encodeURIComponent(interval.queryStart)}&end_date=${encodeURIComponent(interval.end)}`,
        { apiToken }
      ),
      worklogStatePromise
    ]);
    return buildWorkedSummary(entries, currentEntry, interval, worklogState, settings);
  } catch {
    return buildWorkedSummaryError(interval);
  }
}

function buildWorkedSummary(
  entries,
  currentEntry,
  interval,
  worklogState = { entries: {} },
  settings = null
) {
  const timeEntries = Array.isArray(entries) ? entries : [];
  return {
    status: "ok",
    totalSeconds: calculateDailyWorkedSeconds(
      timeEntries, currentEntry, interval.startMs, interval.endMs
    ),
    weekTotalSeconds: calculateDailyWorkedSeconds(
      timeEntries, currentEntry, interval.weekStartMs, interval.endMs
    ),
    calculatedAt: interval.end,
    dayStart: interval.start,
    weekStart: interval.weekStart,
    runningEntryId: isRunningTimeEntry(currentEntry)
      ? Number(currentEntry.id) || null
      : null,
    appointments: buildTodayAppointments(
      timeEntries,
      currentEntry,
      interval,
      worklogState,
      settings
    )
  };
}

function buildWorkedSummaryError(interval) {
  return {
    status: "error",
    totalSeconds: null,
    weekTotalSeconds: null,
    calculatedAt: interval.end,
    dayStart: interval.start,
    weekStart: interval.weekStart,
    runningEntryId: null,
    appointments: [],
    message: "Worked totals are temporarily unavailable. Timer controls still work."
  };
}

function getLocalDayInterval(nowInput = new Date()) {
  const now = nowInput instanceof Date
    ? new Date(nowInput.getTime())
    : new Date(nowInput);

  if (!Number.isFinite(now.getTime())) {
    throw new UserFacingError("INVALID_DATE", "Could not determine the local calendar day.");
  }

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = getLocalWeekStart(now);
  // Toggl filters by entry start, so include Sunday to capture timers crossing Monday.
  const queryStart = new Date(
    weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1
  );
  return {
    start: start.toISOString(),
    weekStart: weekStart.toISOString(),
    queryStart: queryStart.toISOString(),
    end: now.toISOString(),
    startMs: start.getTime(),
    weekStartMs: weekStart.getTime(),
    endMs: now.getTime()
  };
}

function getLocalWeekStart(now) {
  const daysSinceMonday = (now.getDay() + 6) % 7;
  return new Date(
    now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday
  );
}

function calculateDailyWorkedSeconds(
  entries,
  currentEntry,
  dayStartMs,
  nowMs
) {
  const startBoundary = Number(dayStartMs);
  const endBoundary = Number(nowMs);
  if (
    !Number.isFinite(startBoundary) ||
    !Number.isFinite(endBoundary) ||
    endBoundary < startBoundary
  ) {
    return 0;
  }

  let totalSeconds = 0;
  for (const entry of mergeTimeEntriesById(entries, currentEntry)) {
    totalSeconds += getClippedEntrySeconds(entry, startBoundary, endBoundary);
  }

  return Math.max(0, totalSeconds);
}

function mergeTimeEntriesById(entries, currentEntry) {
  const byId = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    mergeTimeEntryIntoMap(byId, entry);
  }
  mergeTimeEntryIntoMap(byId, currentEntry, "current");
  return [...byId.values()];
}

function mergeTimeEntryIntoMap(byId, entry, anonymousKey = "") {
  if (!entry || typeof entry !== "object") {
    return;
  }
  const key = entry.id === null || entry.id === undefined
    ? anonymousKey || `anonymous:${byId.size}`
    : String(entry.id);
  byId.set(key, mergeTimeEntries(byId.get(key), entry));
}

function getClippedEntrySeconds(entry, startMs, endMs) {
  return getClippedEntryInterval(entry, startMs, endMs)?.totalSeconds || 0;
}

function getClippedEntryInterval(entry, startMs, endMs) {
  const interval = getTimeEntryInterval(entry, endMs);
  if (!interval) {
    return null;
  }
  const clippedStart = Math.max(startMs, interval.startMs);
  const clippedEnd = Math.min(endMs, interval.endMs);
  if (clippedEnd <= clippedStart) {
    return null;
  }
  return {
    startMs: clippedStart,
    endMs: clippedEnd,
    totalSeconds: Math.floor((clippedEnd - clippedStart) / 1000)
  };
}

function buildTodayAppointments(entries, currentEntry, interval, state, settings) {
  const groups = new Map();
  for (const entry of mergeTimeEntriesById(entries, currentEntry)) {
    addTodayAppointment(groups, entry, interval, state, settings);
  }
  return [...groups.values()]
    .sort((first, second) =>
      second.lastWorkedAt - first.lastWorkedAt ||
      first.description.localeCompare(second.description)
    )
    .map(({ lastWorkedAt, ...appointment }) => appointment);
}

function addTodayAppointment(groups, entry, interval, state, settings) {
  const identity = getAppointmentIdentity(entry, state, settings?.jiraOrigin);
  const clipped = getClippedEntryInterval(entry, interval.startMs, interval.endMs);
  if (!identity || !clipped) {
    return;
  }

  const group = groups.get(identity.groupKey) || createAppointmentGroup(identity);
  group.totalSeconds += clipped.totalSeconds;
  if (clipped.endMs >= group.lastWorkedAt) {
    group.description = identity.description;
    group.sourceEntryId = identity.sourceEntryId;
    group.lastWorkedAt = clipped.endMs;
  }
  if (isRunningTimeEntry(entry)) {
    group.runningEntryId = identity.sourceEntryId;
  }
  groups.set(identity.groupKey, group);
}

function getAppointmentIdentity(entry, state, jiraOrigin) {
  const sourceEntryId = Number(entry?.id || 0);
  const description = normalizeWhitespace(entry?.description || "");
  if (!isPositiveInteger(sourceEntryId) || !description) {
    return null;
  }
  const issueKey = getAssociatedIssueKey(sourceEntryId, state, jiraOrigin);
  return {
    groupKey: issueKey ? `jira:${issueKey}` : `description:${description}`,
    sourceEntryId,
    issueKey,
    description
  };
}

function createAppointmentGroup(identity) {
  return {
    sourceEntryId: identity.sourceEntryId,
    issueKey: identity.issueKey,
    description: identity.description,
    totalSeconds: 0,
    runningEntryId: null,
    lastWorkedAt: -Infinity
  };
}

function getAssociatedIssueKey(entryId, state, jiraOrigin) {
  const record = state?.entries?.[String(entryId)];
  if (!record || (jiraOrigin && record.jiraOrigin !== jiraOrigin)) {
    return null;
  }
  return isValidJiraIssueKey(record.issueKey)
    ? String(record.issueKey).trim().toUpperCase()
    : null;
}

function getTimeEntryInterval(entry, nowMs) {
  const duration = Number(entry?.duration);
  let startMs = Date.parse(entry?.start || "");

  if (!Number.isFinite(startMs) && Number.isFinite(duration) && duration < 0) {
    const encodedStartSeconds = Math.abs(duration);
    const encodedStartMs = encodedStartSeconds * 1000;
    if (
      encodedStartSeconds >= MIN_PLAUSIBLE_UNIX_SECONDS &&
      encodedStartMs <= nowMs
    ) {
      startMs = encodedStartMs;
    }
  }

  if (!Number.isFinite(startMs)) {
    return null;
  }

  let endMs;
  if (isRunningTimeEntry(entry)) {
    endMs = nowMs;
  } else {
    endMs = Date.parse(entry?.stop || "");
    if (!Number.isFinite(endMs) && Number.isFinite(duration) && duration >= 0) {
      endMs = startMs + duration * 1000;
    }
  }

  if (!Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }

  return { startMs, endMs };
}

function isRunningTimeEntry(entry) {
  if (!entry || typeof entry !== "object" || entry.stop) {
    return false;
  }

  const duration = Number(entry.duration);
  return Number.isFinite(duration) ? duration < 0 : Boolean(entry.start);
}

async function getCurrentJiraInsight(currentEntry, settings, publicSettings) {
  if (!currentEntry) {
    return { status: "not-applicable" };
  }

  const association = await identifyJiraIssueForEntry(currentEntry, settings);
  if (!association) {
    return { status: "not-applicable" };
  }

  if (!publicSettings.jiraConfigured) {
    return {
      status: "error",
      issueKey: association.issueKey,
      detection: association.detection,
      message: "Jira details are unavailable until access to the configured Jira site is granted."
    };
  }

  try {
    const fields = JIRA_PROGRESS_FIELDS.join(",");
    const result = await jiraRequestWithFallback(settings, (apiVersion) => ({
      path: `/rest/api/${apiVersion}/issue/${encodeURIComponent(association.issueKey)}?fields=${fields}`
    }));
    const payload = result.payload && typeof result.payload === "object"
      ? result.payload
      : {};
    const issueKey = isValidJiraIssueKey(payload.key)
      ? String(payload.key).toUpperCase()
      : association.issueKey;
    const issueFields = payload.fields && typeof payload.fields === "object"
      ? payload.fields
      : {};
    const summary = truncate(
      normalizeWhitespace(issueFields.summary || "Untitled Jira issue"),
      1000
    );
    const timeTracking = extractJiraTimeTracking(issueFields);

    return {
      status: "ok",
      issueKey,
      detection: association.detection,
      summary,
      ...timeTracking
    };
  } catch {
    return {
      status: "error",
      issueKey: association.issueKey,
      detection: association.detection,
      message: "Jira progress could not be loaded. You can still stop the timer."
    };
  }
}

async function getJiraClipboard(issueKeyInput, settingsInput = null) {
  const issueKey = normalizeJiraIssueKey(issueKeyInput);
  const settings = settingsInput || await getSettings();

  try {
    const fields = JIRA_CLIPBOARD_FIELDS.join(",");
    const result = await jiraRequestWithFallback(settings, (apiVersion) => ({
      path: `/rest/api/${apiVersion}/issue/${encodeURIComponent(issueKey)}?fields=${fields}`
    }));
    return buildJiraClipboardResult(issueKey, result.payload);
  } catch {
    throw new UserFacingError(
      "JIRA_COPY_UNAVAILABLE",
      "Jira title and description could not be loaded. Check Jira access and try again."
    );
  }
}

function buildJiraClipboardResult(requestedIssueKey, payload) {
  const fields = payload?.fields && typeof payload.fields === "object"
    ? payload.fields
    : {};
  const issueKey = isValidJiraIssueKey(payload?.key)
    ? String(payload.key).trim().toUpperCase()
    : requestedIssueKey;
  const summary = truncate(
    normalizeWhitespace(fields.summary || "Untitled Jira issue"),
    1000
  );
  return {
    issueKey,
    clipboardText: buildJiraClipboardDocument({
      issueKey,
      summary,
      descriptionMarkdown: adfToMarkdown(fields.description)
    })
  };
}

async function identifyJiraIssueForEntry(entry, settings) {
  const entryId = Number(entry?.id || 0);
  if (entryId) {
    const state = await getWorklogState();
    const record = state.entries[String(entryId)];
    if (
      record?.jiraOrigin === settings.jiraOrigin &&
      isValidJiraIssueKey(record.issueKey)
    ) {
      return {
        issueKey: String(record.issueKey).toUpperCase(),
        detection: "association"
      };
    }
  }

  const issueKey = extractJiraIssueKey(entry?.description);
  return issueKey
    ? { issueKey, detection: "description" }
    : null;
}

function extractJiraIssueKey(value) {
  const match = String(value || "").match(JIRA_ISSUE_KEY_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

function isValidJiraIssueKey(value) {
  return /^[A-Z][A-Z0-9_]*-\d+$/.test(String(value || "").trim().toUpperCase());
}

function normalizeJiraIssueKey(value) {
  const candidate = typeof value === "object" ? value?.key : value;
  const issueKey = String(candidate || "").trim().toUpperCase();
  if (!isValidJiraIssueKey(issueKey)) {
    throw new UserFacingError(
      "INVALID_ISSUE_KEY",
      "Could not identify a valid Jira issue key."
    );
  }
  return issueKey;
}

function extractJiraTimeTracking(fields) {
  const tracking = fields?.timetracking && typeof fields.timetracking === "object"
    ? fields.timetracking
    : {};
  const loggedSeconds = firstNonNegativeInteger(
    tracking.timeSpentSeconds,
    fields?.timespent,
    0
  );
  const originalEstimateSeconds = firstNonNegativeInteger(
    tracking.originalEstimateSeconds,
    fields?.timeoriginalestimate,
    null
  );
  const remainingEstimateSeconds = firstNonNegativeInteger(
    tracking.remainingEstimateSeconds,
    fields?.timeestimate,
    null
  );

  return {
    loggedSeconds,
    originalEstimateSeconds,
    remainingEstimateSeconds
  };
}

function firstNonNegativeInteger(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return Math.floor(number);
    }
  }

  return null;
}

function adfToMarkdown(description) {
  if (typeof description === "string") {
    return normalizeMarkdown(description) || "(No description)";
  }

  if (!description || typeof description !== "object") {
    return "(No description)";
  }

  const rendered = renderAdfNode(description, { listDepth: 0 });
  return normalizeMarkdown(rendered) || "(No description)";
}

function renderAdfNode(node, context = {}) {
  if (!node || typeof node !== "object") {
    return "";
  }

  const content = Array.isArray(node.content) ? node.content : [];
  const renderChildren = () => content
    .map((child) => renderAdfNode(child, context))
    .join("");

  switch (node.type) {
    case "doc":
      return renderChildren();

    case "paragraph":
      return `${renderChildren().trimEnd()}\n\n`;

    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return `${"#".repeat(level)} ${renderChildren().trim()}\n\n`;
    }

    case "text":
      return renderAdfText(node);

    case "hardBreak":
      return "\\\n";

    case "rule":
      return "---\n\n";

    case "bulletList":
    case "orderedList":
      return `${renderAdfList(node, context.listDepth || 0)}\n\n`;

    case "taskList":
      return `${renderAdfTaskList(node, context.listDepth || 0)}\n\n`;

    case "listItem":
    case "taskItem":
      return renderChildren();

    case "blockquote": {
      const quote = normalizeMarkdown(renderChildren());
      return `${quote.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }

    case "codeBlock": {
      const code = extractAdfPlainText(node).replace(/\n$/, "");
      const fence = chooseCodeFence(code);
      const language = String(node.attrs?.language || "").replace(/[^A-Za-z0-9_+.-]/g, "");
      return `${fence}${language}\n${code}\n${fence}\n\n`;
    }

    case "mention":
      return `@${normalizeWhitespace(
        node.attrs?.text || node.attrs?.displayName || node.attrs?.id || "mention"
      ).replace(/^@/, "")}`;

    case "emoji":
      return String(node.attrs?.text || node.attrs?.shortName || node.attrs?.id || "");

    case "table":
      return `${renderAdfTable(node)}\n\n`;

    case "tableRow":
    case "tableHeader":
    case "tableCell":
      return renderChildren();

    default:
      return renderChildren();
  }
}

function renderAdfText(node) {
  let text = String(node.text || "");
  const marks = Array.isArray(node.marks) ? node.marks : [];
  const codeMark = marks.find((mark) => mark?.type === "code");

  if (codeMark) {
    const fence = chooseInlineCodeFence(text);
    text = `${fence}${text}${fence}`;
  }

  for (const mark of marks) {
    if (!mark || mark.type === "code") {
      continue;
    }

    if (mark.type === "strong") {
      text = `**${text}**`;
    } else if (mark.type === "em") {
      text = `*${text}*`;
    } else if (mark.type === "strike") {
      text = `~~${text}~~`;
    } else if (mark.type === "link" && mark.attrs?.href) {
      text = `[${text}](${String(mark.attrs.href)})`;
    }
  }

  return text;
}

function renderAdfList(node, depth) {
  const items = (Array.isArray(node.content) ? node.content : [])
    .filter((item) => item?.type === "listItem");
  const ordered = node.type === "orderedList";
  const firstNumber = Math.max(1, Number(node.attrs?.order) || 1);
  const indent = "  ".repeat(depth);

  return items.map((item, index) => {
    const prefix = ordered ? `${firstNumber + index}. ` : "- ";
    return renderAdfListItem(item, indent, prefix, depth);
  }).join("\n");
}

function renderAdfTaskList(node, depth) {
  const items = (Array.isArray(node.content) ? node.content : [])
    .filter((item) => item?.type === "taskItem");
  const indent = "  ".repeat(depth);

  return items.map((item) => {
    const checked = item.attrs?.state === "DONE" || item.attrs?.state === "done";
    return renderAdfListItem(item, indent, `- [${checked ? "x" : " "}] `, depth);
  }).join("\n");
}

function renderAdfListItem(item, indent, prefix, depth) {
  const children = Array.isArray(item.content) ? item.content : [];
  const bodyParts = [];
  const nestedParts = [];

  for (const child of children) {
    if (["bulletList", "orderedList", "taskList"].includes(child?.type)) {
      const rendered = child.type === "taskList"
        ? renderAdfTaskList(child, depth + 1)
        : renderAdfList(child, depth + 1);
      if (rendered) {
        nestedParts.push(rendered);
      }
    } else {
      const rendered = normalizeMarkdown(renderAdfNode(child, { listDepth: depth + 1 }));
      if (rendered) {
        bodyParts.push(rendered);
      }
    }
  }

  const body = bodyParts.join(" ") || " ";
  const continuation = `${indent}${" ".repeat(prefix.length)}`;
  const lines = body.split("\n");
  let result = `${indent}${prefix}${lines[0]}`;
  for (const line of lines.slice(1)) {
    result += `\n${continuation}${line}`;
  }
  if (nestedParts.length > 0) {
    result += `\n${nestedParts.join("\n")}`;
  }
  return result;
}

function renderAdfTable(node) {
  const rows = (Array.isArray(node.content) ? node.content : [])
    .filter((row) => row?.type === "tableRow")
    .map((row) => (Array.isArray(row.content) ? row.content : [])
      .filter((cell) => ["tableHeader", "tableCell"].includes(cell?.type))
      .map((cell) => normalizeMarkdown(renderAdfNode(cell, {}))
        .replace(/\n+/g, " / ")
        .replace(/\|/g, "\\|") || " "));

  if (rows.length === 0) {
    return "";
  }

  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const normalizedRows = rows.map((row) => [
    ...row,
    ...Array(Math.max(0, columnCount - row.length)).fill(" ")
  ]);
  const line = (row) => `| ${row.join(" | ")} |`;
  const separator = Array(columnCount).fill("---");
  return [line(normalizedRows[0]), line(separator), ...normalizedRows.slice(1).map(line)]
    .join("\n");
}

function extractAdfPlainText(node) {
  if (!node || typeof node !== "object") {
    return "";
  }
  if (node.type === "text") {
    return String(node.text || "");
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  return (Array.isArray(node.content) ? node.content : [])
    .map(extractAdfPlainText)
    .join("");
}

function normalizeMarkdown(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chooseInlineCodeFence(content) {
  const longest = longestBacktickRun(content);
  return "`".repeat(Math.max(1, longest + 1));
}

function chooseCodeFence(content) {
  return "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
}

function longestBacktickRun(value) {
  const matches = String(value || "").match(/`+/g) || [];
  return matches.reduce((maximum, match) => Math.max(maximum, match.length), 0);
}

function buildJiraClipboardDocument({ issueKey, summary, descriptionMarkdown }) {
  const title = `[${String(issueKey || "").toUpperCase()}] ${normalizeWhitespace(summary || "")}`;
  const description = normalizeMarkdown(descriptionMarkdown) || "(No description)";
  const titleFence = chooseCodeFence(title);
  const descriptionFence = chooseCodeFence(description);

  return [
    "Title:",
    `${titleFence}text`,
    title,
    titleFence,
    "",
    "Description:",
    `${descriptionFence}md`,
    description,
    descriptionFence
  ].join("\n");
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

async function trackJiraTimer(entry, issue, description, settings) {
  const togglEntryId = normalizeOptionalPositiveInteger(entry?.id, "Time entry ID");
  if (!togglEntryId) {
    return;
  }

  const issueKey = normalizeJiraIssueKey(issue);
  const now = new Date().toISOString();
  const state = await getWorklogState();
  const existing = state.entries[String(togglEntryId)] || {};

  state.entries[String(togglEntryId)] = {
    togglEntryId,
    workspaceId: entry.workspaceId || settings.workspaceId,
    jiraOrigin: settings.jiraOrigin,
    issueKey,
    description,
    started: entry.start || existing.started || now,
    stopped: null,
    durationSeconds: null,
    status: "running",
    worklogId: null,
    lastError: "",
    createdAt: existing.createdAt || now,
    updatedAt: now
  };

  await saveWorklogState(state);
}

async function stopTrackedTimeEntry(current, settings, fallbackIssue = null) {
  const stoppedResponse = await stopTimeEntry(current, settings.apiToken);
  await setActionIcon(false);
  let stoppedEntry = mergeTimeEntries(current, stoppedResponse);

  if (!hasCompletedDuration(stoppedEntry)) {
    const refreshed = await getTimeEntryById(current.id, settings.apiToken).catch(() => null);
    if (refreshed) {
      stoppedEntry = mergeTimeEntries(stoppedEntry, refreshed);
    }
  }

  const worklogSync = await finalizeTrackedTimer(
    stoppedEntry,
    settings,
    fallbackIssue
  );

  return {
    entry: sanitizeEntry(stoppedEntry),
    worklogSync
  };
}

async function finalizeTrackedTimer(entry, settings, fallbackIssue = null) {
  const togglEntryId = normalizeOptionalPositiveInteger(entry?.id, "Time entry ID");
  if (!togglEntryId) {
    return { status: "not-applicable" };
  }

  const state = await getWorklogState();
  let record = state.entries[String(togglEntryId)] || null;

  if (!record && fallbackIssue) {
    const issue = normalizeIssue(fallbackIssue);
    const now = new Date().toISOString();
    record = {
      togglEntryId,
      workspaceId: Number(entry.workspace_id || entry.wid || settings.workspaceId) || null,
      jiraOrigin: settings.jiraOrigin,
      issueKey: issue.key,
      description: String(entry.description || formatDescription(settings.descriptionTemplate, issue)),
      started: entry.start || now,
      stopped: null,
      durationSeconds: null,
      status: "running",
      worklogId: null,
      lastError: "",
      createdAt: now,
      updatedAt: now
    };
  }

  if (!record) {
    return { status: "not-applicable" };
  }

  const durationSeconds = calculateTimeEntryDuration(entry);
  const now = new Date().toISOString();
  record = {
    ...record,
    workspaceId: Number(entry.workspace_id || entry.wid || record.workspaceId || 0) || null,
    description: String(entry.description || record.description || ""),
    started: entry.start || record.started,
    stopped: entry.stop || record.stopped || now,
    durationSeconds,
    status: "pending",
    lastError: "",
    updatedAt: now
  };
  state.entries[String(togglEntryId)] = record;

  if (!settings.syncWorklogs) {
    record.status = "completed";
    state.entries[String(togglEntryId)] = record;
    await saveWorklogState(state);
    return {
      status: "disabled",
      issueKey: record.issueKey,
      durationSeconds
    };
  }

  await saveWorklogState(state);

  if (settings.worklogSyncMode === "manual") {
    return {
      status: "queued",
      reason: "confirmation",
      issueKey: record.issueKey,
      durationSeconds
    };
  }

  return syncTrackedWorklog(togglEntryId, settings);
}

async function syncPendingWorklogs() {
  const settings = await getTogglAccessSettings();
  await reconcileStoppedTrackedTimers(settings, null).catch(() => undefined);

  const state = await getWorklogState();
  const pendingIds = Object.values(state.entries)
    .filter((record) =>
      record?.status === "pending" &&
      record.jiraOrigin === settings.jiraOrigin
    )
    .sort((first, second) => String(first.createdAt).localeCompare(String(second.createdAt)))
    .map((record) => record.togglEntryId);

  let synced = 0;
  let failed = 0;
  const results = [];

  for (const togglEntryId of pendingIds) {
    const result = await syncTrackedWorklog(togglEntryId, settings, { force: true });
    results.push(result);
    if (result.status === "synced") {
      synced += 1;
    } else if (result.status === "queued") {
      failed += 1;
    }
  }

  return {
    synced,
    failed,
    results,
    worklogs: await getWorklogSummary(settings)
  };
}

async function syncTrackedWorklog(togglEntryIdInput, settings, { force = false } = {}) {
  const togglEntryId = normalizeOptionalPositiveInteger(
    togglEntryIdInput,
    "Time entry ID"
  );

  if (!togglEntryId) {
    return { status: "not-applicable" };
  }

  const lockKey = String(togglEntryId);
  if (worklogSyncLocks.has(lockKey)) {
    return worklogSyncLocks.get(lockKey);
  }

  const promise = syncTrackedWorklogUnlocked(togglEntryId, settings, { force })
    .finally(() => worklogSyncLocks.delete(lockKey));
  worklogSyncLocks.set(lockKey, promise);
  return promise;
}

async function syncTrackedWorklogUnlocked(togglEntryId, settings, { force }) {
  const state = await getWorklogState();
  let record = state.entries[String(togglEntryId)] || null;

  if (!record) {
    return { status: "not-applicable" };
  }

  if (record.status === "synced" && record.worklogId) {
    return worklogResultFromRecord(record, { existing: true });
  }

  if (record.jiraOrigin !== settings.jiraOrigin) {
    record.status = "pending";
    record.lastError = "The configured Jira site changed before this Work Log was synced.";
    record.updatedAt = new Date().toISOString();
    state.entries[String(togglEntryId)] = record;
    await saveWorklogState(state);
    return worklogQueuedResult(record, "error");
  }

  if (!force && (!settings.syncWorklogs || settings.worklogSyncMode === "manual")) {
    record.status = "pending";
    record.updatedAt = new Date().toISOString();
    state.entries[String(togglEntryId)] = record;
    await saveWorklogState(state);
    return worklogQueuedResult(record, "confirmation");
  }

  try {
    if (!record.durationSeconds || !record.stopped) {
      const refreshed = await getTimeEntryById(togglEntryId, settings.apiToken);
      if (refreshed) {
        record = {
          ...record,
          description: String(refreshed.description || record.description || ""),
          started: refreshed.start || record.started,
          stopped: refreshed.stop || record.stopped,
          durationSeconds: calculateTimeEntryDuration(refreshed),
          updatedAt: new Date().toISOString()
        };
      }
    }

    if (!record.durationSeconds || record.durationSeconds < 1) {
      throw new UserFacingError(
        "INVALID_WORKLOG_DURATION",
        "The stopped Toggl entry does not have a valid duration yet."
      );
    }

    const existing = await findExistingJiraWorklog(record, settings);
    let worklog = existing;

    if (!worklog) {
      worklog = await createJiraWorklog(record, settings);
    }

    record.status = "synced";
    record.worklogId = String(worklog?.id || record.worklogId || "");
    record.lastError = "";
    record.updatedAt = new Date().toISOString();
    state.entries[String(togglEntryId)] = record;
    await saveWorklogState(state);

    return worklogResultFromRecord(record, { existing: Boolean(existing) });
  } catch (error) {
    record.status = "pending";
    record.lastError = error instanceof Error
      ? error.message
      : "The Jira Work Log could not be created.";
    record.updatedAt = new Date().toISOString();
    state.entries[String(togglEntryId)] = record;
    await saveWorklogState(state);
    return worklogQueuedResult(record, "error");
  }
}

async function reconcileStoppedTrackedTimers(settings, currentEntryId = null) {
  if (!settings.apiToken || !settings.jiraOrigin) {
    return;
  }

  const currentId = Number(currentEntryId || 0) || null;
  const state = await getWorklogState();
  const runningRecords = Object.values(state.entries)
    .filter((record) =>
      record?.status === "running" &&
      record.jiraOrigin === settings.jiraOrigin &&
      record.togglEntryId !== currentId
    )
    .sort((first, second) => String(first.createdAt).localeCompare(String(second.createdAt)))
    .slice(0, WORKLOG_RECONCILE_LIMIT);

  for (const record of runningRecords) {
    try {
      const entry = await getTimeEntryById(record.togglEntryId, settings.apiToken);
      if (entry && hasCompletedDuration(entry)) {
        await finalizeTrackedTimer(entry, settings);
      }
    } catch {
      // The pending record remains available for a later side-panel refresh or manual retry.
    }
  }
}

async function getWorklogSummary(settings) {
  const state = await getWorklogState();
  const records = Object.values(state.entries)
    .filter((record) => !settings?.jiraOrigin || record.jiraOrigin === settings.jiraOrigin);
  const pending = records
    .filter((record) => record.status === "pending")
    .sort((first, second) => String(second.updatedAt).localeCompare(String(first.updatedAt)));

  return {
    enabled: settings?.syncWorklogs === true,
    mode: settings?.worklogSyncMode || DEFAULT_SETTINGS.worklogSyncMode,
    pendingCount: pending.length,
    runningCount: records.filter((record) => record.status === "running").length,
    pending: pending.slice(0, 5).map((record) => ({
      togglEntryId: record.togglEntryId,
      issueKey: record.issueKey,
      description: record.description,
      durationSeconds: record.durationSeconds,
      lastError: record.lastError,
      needsConfirmation: !record.lastError
    }))
  };
}

async function getWorklogState() {
  const stored = await chrome.storage.local.get(WORKLOG_STATE_KEY);
  const saved = stored[WORKLOG_STATE_KEY];
  const entries = saved && typeof saved.entries === "object" && saved.entries
    ? saved.entries
    : {};

  return {
    version: WORKLOG_STATE_VERSION,
    entries: { ...entries }
  };
}

async function saveWorklogState(state) {
  const entries = Object.values(state?.entries || {})
    .filter((record) => record && Number(record.togglEntryId) > 0)
    .sort((first, second) => String(second.updatedAt).localeCompare(String(first.updatedAt)));

  const protectedRecords = entries.filter((record) =>
    ["running", "pending"].includes(record.status)
  );
  const terminalRecords = entries.filter((record) =>
    !["running", "pending"].includes(record.status)
  );
  const keep = [...protectedRecords, ...terminalRecords]
    .slice(0, Math.max(MAX_WORKLOG_RECORDS, protectedRecords.length));
  const normalizedEntries = Object.fromEntries(
    keep.map((record) => [String(record.togglEntryId), record])
  );

  await chrome.storage.local.set({
    [WORKLOG_STATE_KEY]: {
      version: WORKLOG_STATE_VERSION,
      entries: normalizedEntries
    }
  });
}

async function clearWorklogState() {
  await chrome.storage.local.remove(WORKLOG_STATE_KEY);
}

async function findExistingJiraWorklog(record, settings) {
  let startAt = 0;
  const maxResults = 1000;

  for (let page = 0; page < 20; page += 1) {
    const result = await jiraRequestWithFallback(settings, (apiVersion) => ({
      path: `/rest/api/${apiVersion}/issue/${encodeURIComponent(record.issueKey)}/worklog?startAt=${startAt}&maxResults=${maxResults}&expand=properties`
    }));
    const worklogs = Array.isArray(result.payload?.worklogs)
      ? result.payload.worklogs
      : [];
    const existing = worklogs.find((worklog) =>
      worklogHasTogglEntryId(worklog, record.togglEntryId)
    );

    if (existing) {
      return existing;
    }

    const total = Number(result.payload?.total || worklogs.length);
    startAt += worklogs.length;
    if (worklogs.length === 0 || startAt >= total) {
      return null;
    }
  }

  return null;
}

async function createJiraWorklog(record, settings) {
  const timeSpentSeconds = applyWorklogRounding(
    record.durationSeconds,
    settings.worklogRounding
  );
  const comment = formatWorklogComment(settings.worklogCommentTemplate, record);
  const property = {
    key: WORKLOG_PROPERTY_KEY,
    value: {
      schemaVersion: WORKLOG_STATE_VERSION,
      togglTimeEntryId: record.togglEntryId,
      togglWorkspaceId: record.workspaceId,
      source: CREATED_WITH
    }
  };

  const result = await jiraRequestWithFallback(settings, (apiVersion) => {
    const body = {
      timeSpentSeconds,
      started: formatJiraStarted(record.started),
      properties: [property]
    };

    if (comment) {
      body.comment = apiVersion === "3"
        ? toAtlassianDocument(comment)
        : comment;
    }

    return {
      method: "POST",
      path: `/rest/api/${apiVersion}/issue/${encodeURIComponent(record.issueKey)}/worklog?adjustEstimate=auto&notifyUsers=false`,
      body
    };
  });

  return result.payload;
}

async function jiraRequestWithFallback(settings, requestFactory) {
  let lastError = null;

  for (let index = 0; index < WORKLOG_API_VERSIONS.length; index += 1) {
    const apiVersion = WORKLOG_API_VERSIONS[index];
    const request = requestFactory(apiVersion);
    const result = await jiraRequest(settings, request).catch((error) => ({ error }));

    if (!result.error) {
      return { ...result, apiVersion };
    }

    lastError = result.error;
    const canFallback =
      result.error?.status &&
      [404, 405].includes(result.error.status) &&
      index < WORKLOG_API_VERSIONS.length - 1;

    if (!canFallback) {
      throw result.error;
    }
  }

  throw lastError || new UserFacingError(
    "JIRA_WORKLOG_ERROR",
    "Jira did not accept the Work Log request."
  );
}

async function jiraRequest(settings, request = {}) {
  const { method = "GET", path, body } = request;
  const url = new URL(path, settings.jiraOrigin);
  let response;

  try {
    response = await fetch(url, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    throw new UserFacingError(
      "JIRA_NETWORK_ERROR",
      "Could not connect to Jira. Open Jira, check your connection, and retry the pending Work Log."
    );
  }

  const text = await response.text();
  const payload = parseResponseBody(text);

  if (!response.ok) {
    const error = mapJiraError(response.status, payload);
    error.status = response.status;
    throw error;
  }

  return { payload, status: response.status };
}

function mapJiraError(status, payload) {
  const detail = truncate(extractJiraApiError(payload), 180);

  if (status === 401) {
    return new UserFacingError(
      "JIRA_AUTH_ERROR",
      "Jira did not accept the current session. Open the configured Jira site, sign in, and retry."
    );
  }

  if (status === 403) {
    return new UserFacingError(
      "JIRA_WORKLOG_PERMISSION",
      "Jira denied the Work Log. The user needs Browse projects and Work on issues permission."
    );
  }

  if (status === 404) {
    return new UserFacingError(
      "JIRA_WORKLOG_NOT_FOUND",
      detail || "The Jira issue or Work Log endpoint was not found."
    );
  }

  if (status === 400) {
    return new UserFacingError(
      "JIRA_WORKLOG_REJECTED",
      detail || "Jira rejected the Work Log. Confirm that time tracking is enabled."
    );
  }

  if (status >= 500) {
    return new UserFacingError(
      "JIRA_SERVER_ERROR",
      "Jira is temporarily unavailable. The Work Log remains pending."
    );
  }

  return new UserFacingError(
    "JIRA_WORKLOG_ERROR",
    detail || `Jira rejected the Work Log request (HTTP ${status}).`
  );
}

function extractJiraApiError(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (Array.isArray(payload?.errorMessages)) {
    return payload.errorMessages.map(String).join(", ");
  }

  if (payload?.errors && typeof payload.errors === "object") {
    return Object.values(payload.errors).map(String).join(", ");
  }

  return extractApiError(payload);
}

function worklogHasTogglEntryId(worklog, togglEntryId) {
  const properties = Array.isArray(worklog?.properties) ? worklog.properties : [];
  return properties.some((property) => {
    if (property?.key !== WORKLOG_PROPERTY_KEY) {
      return false;
    }

    const value = property.value || {};
    return Number(value.togglTimeEntryId) === Number(togglEntryId);
  });
}

function formatWorklogComment(template, record) {
  let comment = normalizeWorklogCommentTemplate(template);
  const values = {
    description: record.description || "",
    issueKey: record.issueKey || "",
    togglId: String(record.togglEntryId || "")
  };

  for (const variable of WORKLOG_COMMENT_VARIABLES) {
    comment = comment.replaceAll(`{${variable}}`, values[variable]);
  }

  return truncate(normalizeWhitespace(comment), 2000);
}

function toAtlassianDocument(text) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }]
      }
    ]
  };
}

function applyWorklogRounding(durationSeconds, rounding) {
  const seconds = Math.max(1, Math.floor(Number(durationSeconds) || 0));

  if (rounding === "ceil-minute") {
    return Math.max(60, Math.ceil(seconds / 60) * 60);
  }

  return Math.max(60, Math.round(seconds / 60) * 60);
}

function formatJiraStarted(value) {
  const parsed = Date.parse(value || "");
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  return date.toISOString().replace(/Z$/, "+0000");
}

function calculateTimeEntryDuration(entry) {
  const rawDuration = entry?.duration;
  const duration = Number(rawDuration);
  if (rawDuration !== null && rawDuration !== undefined && Number.isFinite(duration) && duration >= 0) {
    return Math.max(1, Math.floor(duration));
  }

  const startedAt = Date.parse(entry?.start || "");
  const stoppedAt = Date.parse(entry?.stop || "");
  if (Number.isFinite(startedAt) && Number.isFinite(stoppedAt) && stoppedAt >= startedAt) {
    return Math.max(1, Math.floor((stoppedAt - startedAt) / 1000));
  }

  return null;
}

function hasCompletedDuration(entry) {
  const rawDuration = entry?.duration;
  return Boolean(entry?.stop) || (
    rawDuration !== null &&
    rawDuration !== undefined &&
    Number.isFinite(Number(rawDuration)) &&
    Number(rawDuration) >= 0
  );
}

function mergeTimeEntries(first, second) {
  return {
    ...(first || {}),
    ...(second || {}),
    id: second?.id || first?.id,
    workspace_id:
      second?.workspace_id || second?.wid || first?.workspace_id || first?.wid,
    description: second?.description || first?.description || "",
    start: second?.start || first?.start || null,
    stop: second?.stop || first?.stop || null
  };
}

async function getTimeEntryById(timeEntryId, apiToken) {
  return togglRequest(`/api/v9/me/time_entries/${timeEntryId}`, {
    apiToken,
    notFoundAsNull: true
  });
}

function normalizeAppointmentSourceId(value) {
  const sourceEntryId = normalizeOptionalPositiveInteger(
    value,
    "Appointment source time-entry ID"
  );
  if (!sourceEntryId) {
    throw new UserFacingError(
      "INVALID_APPOINTMENT_SOURCE",
      "The appointment source time-entry ID must be a positive integer."
    );
  }
  return sourceEntryId;
}

function validateTodayAppointmentSource(entry, sourceEntryId) {
  if (!entry || Number(entry.id) !== sourceEntryId) {
    throw new UserFacingError(
      "APPOINTMENT_UNAVAILABLE",
      "The selected appointment is no longer available in Toggl."
    );
  }
  const interval = getLocalDayInterval(new Date());
  if (!getClippedEntryInterval(entry, interval.startMs, interval.endMs)) {
    throw new UserFacingError(
      "APPOINTMENT_NOT_TODAY",
      "The selected appointment is not part of today anymore."
    );
  }
}

function worklogResultFromRecord(record, { existing = false } = {}) {
  return {
    status: "synced",
    issueKey: record.issueKey,
    togglEntryId: record.togglEntryId,
    worklogId: record.worklogId || null,
    durationSeconds: record.durationSeconds,
    existing
  };
}

function worklogQueuedResult(record, reason) {
  return {
    status: "queued",
    reason,
    issueKey: record.issueKey,
    togglEntryId: record.togglEntryId,
    durationSeconds: record.durationSeconds,
    error: record.lastError || ""
  };
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

function normalizeWorklogSyncMode(value) {
  const mode = String(value || DEFAULT_SETTINGS.worklogSyncMode);
  if (!["automatic", "manual"].includes(mode)) {
    throw new UserFacingError(
      "INVALID_WORKLOG_SYNC_MODE",
      "Choose Automatic or Ask before syncing for Jira Work Logs."
    );
  }
  return mode;
}

function coerceWorklogSyncMode(value) {
  return ["automatic", "manual"].includes(value)
    ? value
    : DEFAULT_SETTINGS.worklogSyncMode;
}

function normalizeWorklogRounding(value) {
  const rounding = String(value || DEFAULT_SETTINGS.worklogRounding);
  if (rounding === "exact") {
    return "nearest-minute";
  }
  if (!["nearest-minute", "ceil-minute"].includes(rounding)) {
    throw new UserFacingError(
      "INVALID_WORKLOG_ROUNDING",
      "Choose a valid Jira Work Log rounding option."
    );
  }
  return rounding;
}

function coerceWorklogRounding(value) {
  if (value === "exact") {
    return "nearest-minute";
  }
  return ["nearest-minute", "ceil-minute"].includes(value)
    ? value
    : DEFAULT_SETTINGS.worklogRounding;
}

function normalizeWorklogCommentTemplate(value) {
  const template = value === undefined || value === null
    ? DEFAULT_SETTINGS.worklogCommentTemplate
    : String(value).trim();

  if (template.length > 500) {
    throw new UserFacingError(
      "WORKLOG_COMMENT_TOO_LONG",
      "The Jira Work Log comment template can contain at most 500 characters."
    );
  }

  const unknownVariables = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map((match) => match[1])
    .filter((name) => !WORKLOG_COMMENT_VARIABLE_SET.has(name));

  if (unknownVariables.length > 0) {
    const names = [...new Set(unknownVariables)].map((name) => `{${name}}`).join(", ");
    throw new UserFacingError(
      "UNKNOWN_WORKLOG_COMMENT_VARIABLE",
      `Unknown Work Log comment variable${unknownVariables.length > 1 ? "s" : ""}: ${names}.`
    );
  }

  return template;
}

function coerceWorklogCommentTemplate(value) {
  try {
    return normalizeWorklogCommentTemplate(value);
  } catch {
    return DEFAULT_SETTINGS.worklogCommentTemplate;
  }
}

function normalizeFloatingButtonPosition(value) {
  const position = String(
    value || DEFAULT_SETTINGS.floatingButtonPosition
  ).trim();
  if (!FLOATING_BUTTON_POSITION_SET.has(position)) {
    throw new UserFacingError(
      "INVALID_FLOATING_BUTTON_POSITION",
      "Choose a valid floating button position."
    );
  }
  return position;
}

function coerceFloatingButtonPosition(value) {
  try {
    return normalizeFloatingButtonPosition(value);
  } catch {
    return DEFAULT_SETTINGS.floatingButtonPosition;
  }
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
    return true;
  }

  try {
    const origins = [toJiraMatchPattern(jiraOrigin)];
    await chrome.permissions.remove({ origins });
    return !(await chrome.permissions.contains({ origins }));
  } catch {
    return false;
  }
}

async function hasTogglConnectionPermissions() {
  try {
    return await chrome.permissions.contains({ origins: TOGGL_CONNECTION_MATCHES });
  } catch {
    return false;
  }
}

async function removeTogglConnectionPermissions() {
  try {
    await chrome.permissions.remove({ origins: TOGGL_CONNECTION_MATCHES });
    return !(await hasAnyTogglConnectionPermission());
  } catch {
    return false;
  }
}

async function hasAnyTogglConnectionPermission() {
  try {
    for (const origin of TOGGL_CONNECTION_MATCHES) {
      if (await chrome.permissions.contains({ origins: [origin] })) return true;
    }
    return false;
  } catch {
    return true;
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


function isPositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}

function hasStartConfiguration(settings) {
  return Boolean(
    settings?.apiToken &&
    isPositiveInteger(settings.workspaceId)
  );
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
