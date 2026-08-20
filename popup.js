"use strict";

const workspaceElement = document.getElementById("workspace");
const workedTodayElement = document.getElementById("worked-today");
const workedTodayValueElement = document.getElementById("worked-today-value");
const workedTodayMessageElement = document.getElementById("worked-today-message");
const timerElement = document.getElementById("timer");
const descriptionElement = document.getElementById("description");
const billingElement = document.getElementById("billing");
const elapsedElement = document.getElementById("elapsed");
const manualElement = document.getElementById("manual");
const manualForm = document.getElementById("manual-form");
const manualDescriptionInput = document.getElementById("manual-description");
const manualBillingElement = document.getElementById("manual-billing");
const manualContextElement = document.getElementById("manual-context");
const startButton = document.getElementById("start");
const jiraProgressElement = document.getElementById("jira-progress");
const jiraKeyElement = document.getElementById("jira-key");
const jiraProgressSummaryElement = document.getElementById("jira-progress-summary");
const jiraProgressDetailElement = document.getElementById("jira-progress-detail");
const copyJiraButton = document.getElementById("copy-jira");
const copyStatusElement = document.getElementById("copy-status");
const worklogsElement = document.getElementById("worklogs");
const worklogsCountElement = document.getElementById("worklogs-count");
const worklogsListElement = document.getElementById("worklogs-list");
const syncWorklogsButton = document.getElementById("sync-worklogs");
const emptyElement = document.getElementById("empty");
const noticeElement = document.getElementById("notice");
const errorElement = document.getElementById("error");
const stopButton = document.getElementById("stop");
const settingsButton = document.getElementById("settings");

let currentEntry = null;
let currentSettings = null;
let currentWorklogs = null;
let currentWorkedToday = null;
let currentJiraInsight = null;
let clockTimer = null;
let loadSequence = 0;
let midnightRefreshPending = false;

settingsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

stopButton.addEventListener("click", () => {
  void stopTimer();
});

syncWorklogsButton.addEventListener("click", () => {
  void syncPendingWorklogs();
});

copyJiraButton.addEventListener("click", () => {
  void copyJiraDetails();
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void startManualTimer();
});

void loadState();

async function loadState() {
  const sequence = ++loadSequence;
  setError("");
  const response = await sendMessage({ type: "GET_POPUP_STATE" });

  if (sequence !== loadSequence) {
    return;
  }

  if (!response.ok) {
    workspaceElement.textContent = "Connection error";
    workedTodayValueElement.textContent = "—";
    workedTodayMessageElement.textContent = "Could not load the daily total.";
    workedTodayMessageElement.classList.remove("hidden");
    emptyElement.classList.add("hidden");
    manualElement.classList.add("hidden");
    timerElement.classList.add("hidden");
    jiraProgressElement.classList.add("hidden");
    worklogsElement.classList.add("hidden");
    stopButton.classList.add("hidden");
    setError(response.error?.message || "Could not check Toggl.");
    return;
  }

  const { settings, current, workedToday, jira, worklogs } = response.data;
  currentSettings = settings || {};
  currentWorklogs = worklogs || {};
  currentWorkedToday = workedToday || { status: "not-configured" };
  currentJiraInsight = jira || { status: "not-applicable" };

  renderWorkspace(currentSettings);
  renderWorkedToday(currentWorkedToday);
  renderCurrent(current, currentSettings);
  renderJira(currentJiraInsight);
  renderWorklogs(currentWorklogs);
  restartClock();
}

function renderWorkspace(settings) {
  if (!settings?.hasApiToken) {
    workspaceElement.textContent = "Toggl is not connected";
    return;
  }

  const workspace = settings.workspaceName ||
    (settings.workspaceId ? `Workspace ${settings.workspaceId}` : "Workspace required");
  const project = settings.projectConfigured
    ? settings.projectName || `Project ${settings.projectId}`
    : "No project";
  workspaceElement.textContent = `${workspace} · ${project}`;
}

function renderWorkedToday(summary) {
  currentWorkedToday = summary || { status: "not-configured" };
  workedTodayElement.classList.remove("hidden");

  if (currentWorkedToday.status === "ok") {
    workedTodayValueElement.textContent = formatWorkedDuration(
      getLiveWorkedTodaySeconds(currentWorkedToday)
    );
    workedTodayMessageElement.textContent = "";
    workedTodayMessageElement.classList.add("hidden");
    return;
  }

  workedTodayValueElement.textContent = "—";
  workedTodayMessageElement.textContent = currentWorkedToday.message ||
    "Worked today is unavailable.";
  workedTodayMessageElement.classList.remove("hidden");
}

function renderCurrent(entry, settings = currentSettings) {
  currentEntry = entry || null;
  currentSettings = settings || currentSettings || {};

  if (!currentEntry) {
    timerElement.classList.add("hidden");
    stopButton.classList.add("hidden");

    if (currentSettings.togglConfigured) {
      emptyElement.classList.add("hidden");
      renderManualDefaults(currentSettings);
      manualElement.classList.remove("hidden");
      window.setTimeout(() => manualDescriptionInput.focus(), 0);
    } else {
      manualElement.classList.add("hidden");
      emptyElement.textContent = configurationMessage(currentSettings, false);
      emptyElement.classList.remove("hidden");
    }
    return;
  }

  descriptionElement.textContent = currentEntry.description || "No description";
  billingElement.textContent = currentEntry.billable ? "Billable" : "Non-billable";
  billingElement.classList.toggle("nonbillable", !currentEntry.billable);
  billingElement.classList.remove("hidden");
  timerElement.classList.remove("hidden");
  manualElement.classList.add("hidden");
  stopButton.classList.remove("hidden");

  if (currentSettings.togglConfigured) {
    emptyElement.classList.add("hidden");
  } else {
    emptyElement.textContent = configurationMessage(currentSettings, true);
    emptyElement.classList.remove("hidden");
  }

  updateElapsed();
}

function configurationMessage(settings, hasRunningTimer) {
  const message = settings?.configurationRequired === "workspace"
    ? "Open Settings and select a valid Toggl workspace."
    : "Open Settings and connect your Toggl account before starting a timer.";

  return hasRunningTimer
    ? `${message} This running timer can still be stopped.`
    : message;
}

function renderManualDefaults(settings) {
  manualBillingElement.textContent = settings.billable ? "Billable" : "Non-billable";
  manualBillingElement.classList.toggle("billable", settings.billable === true);

  const project = settings.projectName
    ? `Project: ${settings.projectName}`
    : "No Toggl project selected";
  const jiraNote = settings.jiraConfigured
    ? "You can also start a timer directly from a Jira issue."
    : "Grant Jira access in Settings to use the Jira button.";
  const worklogNote = settings.syncWorklogs
    ? "Work Logs apply only to timers started from the Jira button."
    : "Jira Work Log sync is off.";
  manualContextElement.textContent = `${project}. ${jiraNote} ${worklogNote}`;
}

function renderJira(insight) {
  currentJiraInsight = insight || { status: "not-applicable" };
  setCopyStatus("");

  if (currentJiraInsight.status === "not-applicable") {
    jiraProgressElement.classList.add("hidden");
    copyJiraButton.classList.add("hidden");
    return;
  }

  jiraKeyElement.textContent = currentJiraInsight.issueKey || "Jira issue";
  jiraProgressElement.classList.remove("hidden");

  if (currentJiraInsight.status !== "ok") {
    jiraProgressSummaryElement.textContent = "Progress unavailable";
    jiraProgressDetailElement.textContent = currentJiraInsight.message ||
      "Jira details could not be loaded. You can still stop the timer.";
    copyJiraButton.classList.add("hidden");
    return;
  }

  const lines = getJiraProgressLines(currentJiraInsight);
  jiraProgressSummaryElement.textContent = lines.summary;
  jiraProgressDetailElement.textContent = lines.detail;
  copyJiraButton.disabled = false;
  copyJiraButton.textContent = "Copy Jira title & description";
  copyJiraButton.classList.remove("hidden");
}

function getJiraProgressLines(insight) {
  const logged = Math.max(0, Math.floor(Number(insight?.loggedSeconds) || 0));
  const originalValue = insight?.originalEstimateSeconds;
  const original = originalValue === null || originalValue === undefined
    ? null
    : Math.max(0, Math.floor(Number(originalValue) || 0));
  if (original === null) {
    return {
      summary: `${formatWorkedDuration(logged)} logged`,
      detail: "No original estimate"
    };
  }

  const summary = `${formatWorkedDuration(logged)} logged / ${formatWorkedDuration(original)} original`;
  if (logged > original) {
    return {
      summary,
      detail: `${formatWorkedDuration(logged - original)} over estimate`
    };
  }

  const left = Math.max(0, original - logged);
  return {
    summary,
    detail: `${formatWorkedDuration(left)} left`
  };
}

async function copyJiraDetails() {
  if (currentJiraInsight?.status !== "ok" || !currentJiraInsight.clipboardText) {
    setCopyStatus("Jira details are not ready to copy.", true);
    return;
  }

  copyJiraButton.disabled = true;
  copyJiraButton.textContent = "Copying…";
  setCopyStatus("");

  try {
    await navigator.clipboard.writeText(currentJiraInsight.clipboardText);
    setCopyStatus("Copied to clipboard");
  } catch {
    setCopyStatus("Could not copy. Check clipboard access and try again.", true);
  } finally {
    copyJiraButton.disabled = false;
    copyJiraButton.textContent = "Copy Jira title & description";
  }
}

function setCopyStatus(message, isError = false) {
  copyStatusElement.textContent = message;
  copyStatusElement.classList.toggle("hidden", !message);
  copyStatusElement.classList.toggle("error-state", Boolean(message && isError));
}

function renderWorklogs(worklogs) {
  currentWorklogs = worklogs || {
    enabled: false,
    pendingCount: 0,
    pending: []
  };
  const pending = Array.isArray(currentWorklogs.pending)
    ? currentWorklogs.pending
    : [];
  const pendingCount = Number(currentWorklogs.pendingCount || pending.length);

  worklogsElement.classList.toggle("hidden", pendingCount === 0);
  worklogsCountElement.textContent = `${pendingCount} pending`;
  worklogsListElement.replaceChildren();

  for (const record of pending) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${record.issueKey || "Jira issue"} · ${formatWorklogDuration(record.durationSeconds)}`;
    const description = document.createElement("span");
    description.textContent = record.description || `Toggl entry ${record.togglEntryId}`;
    item.append(title, description);

    if (record.lastError) {
      const error = document.createElement("span");
      error.className = "worklog-error";
      error.textContent = record.lastError;
      item.appendChild(error);
    } else if (record.needsConfirmation) {
      const confirmation = document.createElement("span");
      confirmation.textContent = "Waiting for confirmation.";
      item.appendChild(confirmation);
    }

    worklogsListElement.appendChild(item);
  }

  syncWorklogsButton.textContent = pendingCount === 1
    ? "Sync pending Work Log"
    : "Sync pending Work Logs";
}

async function startManualTimer() {
  const description = manualDescriptionInput.value.replace(/\s+/g, " ").trim();

  if (!description) {
    setError("Enter a description before starting the timer.");
    manualDescriptionInput.focus();
    return;
  }

  setError("");
  setNotice("");
  setStartBusy(true);
  const response = await sendMessage({
    type: "START_MANUAL_TIMER",
    description
  });
  setStartBusy(false);

  if (!response.ok) {
    setError(response.error?.message || "Could not start the timer.");
    manualDescriptionInput.focus();
    return;
  }

  manualDescriptionInput.value = "";
  const previousResult = response.data?.previousWorklogSync;
  await loadState();
  if (previousResult) {
    showWorklogResult(previousResult, true);
  } else {
    setNotice("Timer started in Toggl.", "success");
  }
}

async function stopTimer() {
  stopButton.disabled = true;
  stopButton.textContent = "Stopping…";
  setError("");
  setNotice("");
  const response = await sendMessage({ type: "STOP_CURRENT_TIMER" });
  stopButton.disabled = false;
  stopButton.textContent = "Stop timer";

  if (!response.ok) {
    setError(response.error?.message || "Could not stop the timer.");
    return;
  }

  const worklogResult = response.data?.worklogSync;
  await loadState();
  showWorklogResult(worklogResult, false);
}

async function syncPendingWorklogs() {
  syncWorklogsButton.disabled = true;
  syncWorklogsButton.textContent = "Syncing…";
  setError("");
  setNotice("");
  const response = await sendMessage({ type: "SYNC_PENDING_WORKLOGS" });
  syncWorklogsButton.disabled = false;

  if (!response.ok) {
    setError(response.error?.message || "Could not sync the pending Work Logs.");
    renderWorklogs(currentWorklogs);
    return;
  }

  renderWorklogs(response.data?.worklogs);
  const synced = Number(response.data?.synced || 0);
  const failed = Number(response.data?.failed || 0);

  if (failed > 0) {
    setNotice(
      `${synced} Work Log${synced === 1 ? "" : "s"} synced; ${failed} still pending.`,
      "warning"
    );
  } else {
    setNotice(
      `${synced} Jira Work Log${synced === 1 ? "" : "s"} synced.`,
      "success"
    );
  }
}

function showWorklogResult(result, previousTimer) {
  if (!result || ["not-applicable", "disabled"].includes(result.status)) {
    setNotice(previousTimer ? "The previous timer stopped and the new timer started." : "Timer stopped in Toggl.", "success");
    return;
  }

  const prefix = previousTimer ? "The previous timer stopped." : "Timer stopped.";

  if (result.status === "synced") {
    setNotice(`${prefix} Jira Work Log created for ${result.issueKey}.`, "success");
    return;
  }

  if (result.status === "queued" && result.reason === "confirmation") {
    setNotice(`${prefix} Confirm the ${result.issueKey} Work Log below.`, "warning");
    return;
  }

  if (result.status === "queued") {
    setNotice(`${prefix} The ${result.issueKey} Work Log is pending and can be retried below.`, "warning");
  }
}

function setStartBusy(busy) {
  startButton.disabled = busy;
  manualDescriptionInput.disabled = busy;
  startButton.textContent = busy ? "Starting…" : "Start timer";
}

function restartClock() {
  window.clearInterval(clockTimer);
  updateLiveValues();
  clockTimer = window.setInterval(updateLiveValues, 1000);
}

function updateLiveValues() {
  updateElapsed();

  if (currentWorkedToday?.status === "ok") {
    workedTodayValueElement.textContent = formatWorkedDuration(
      getLiveWorkedTodaySeconds(currentWorkedToday)
    );

    const dayStart = Date.parse(currentWorkedToday.dayStart || "");
    if (
      Number.isFinite(dayStart) &&
      new Date(dayStart).toDateString() !== new Date().toDateString() &&
      !midnightRefreshPending
    ) {
      midnightRefreshPending = true;
      void loadState().finally(() => {
        midnightRefreshPending = false;
      });
    }
  }
}

function getLiveWorkedTodaySeconds(summary, nowMs = Date.now()) {
  const total = Math.max(0, Math.floor(Number(summary?.totalSeconds) || 0));
  const runningId = Number(summary?.runningEntryId || 0);
  if (!runningId || Number(currentEntry?.id || 0) !== runningId || currentEntry?.stop) {
    return total;
  }

  const calculatedAt = Date.parse(summary?.calculatedAt || "");
  if (!Number.isFinite(calculatedAt)) {
    return total;
  }

  return total + Math.max(0, Math.floor((Number(nowMs) - calculatedAt) / 1000));
}

function updateElapsed() {
  if (!currentEntry?.start) {
    elapsedElement.textContent = "00:00:00";
    return;
  }

  const startedAt = Date.parse(currentEntry.start);
  if (!Number.isFinite(startedAt)) {
    elapsedElement.textContent = "--:--:--";
    return;
  }

  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  elapsedElement.textContent = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatWorkedDuration(value) {
  const totalMinutes = Math.max(0, Math.floor((Number(value) || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return minutes === 0
    ? `${hours}h`
    : `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatWorklogDuration(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", seconds ? `${seconds}s` : ""]
    .filter(Boolean)
    .join(" ");
}

function setNotice(message, type = "") {
  noticeElement.textContent = message;
  noticeElement.className = `notice${message ? "" : " hidden"}${type ? ` ${type}` : ""}`;
}

function setError(message) {
  errorElement.textContent = message;
  errorElement.classList.toggle("hidden", !message);
}

async function sendMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response || { ok: false, error: { message: "The extension did not respond." } };
  } catch {
    return {
      ok: false,
      error: { message: "The extension was reloaded. Open the popup again." }
    };
  }
}
