"use strict";

const workspaceElement = document.getElementById("workspace");
const timerElement = document.getElementById("timer");
const descriptionElement = document.getElementById("description");
const elapsedElement = document.getElementById("elapsed");
const billingElement = document.getElementById("billing");
const manualElement = document.getElementById("manual");
const manualForm = document.getElementById("manual-form");
const manualDescriptionInput = document.getElementById("manual-description");
const manualBillingElement = document.getElementById("manual-billing");
const manualContextElement = document.getElementById("manual-context");
const startButton = document.getElementById("start");
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
let clockTimer = null;

settingsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

stopButton.addEventListener("click", () => {
  void stopTimer();
});

syncWorklogsButton.addEventListener("click", () => {
  void syncPendingWorklogs();
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void startManualTimer();
});

void loadState();

async function loadState() {
  setError("");
  const response = await sendMessage({ type: "GET_POPUP_STATE" });

  if (!response.ok) {
    workspaceElement.textContent = "Connection error";
    emptyElement.classList.add("hidden");
    manualElement.classList.add("hidden");
    worklogsElement.classList.add("hidden");
    setError(response.error?.message || "Could not check Toggl.");
    return;
  }

  const { settings, current, worklogs } = response.data;
  currentSettings = settings;
  currentWorklogs = worklogs;
  workspaceElement.textContent = settings.togglConfigured
    ? settings.workspaceName || `Workspace ${settings.workspaceId}`
    : "Toggl is not configured";
  renderWorklogs(worklogs);

  if (!settings.togglConfigured) {
    emptyElement.textContent = "Open Settings and enter your Toggl Track API token.";
    emptyElement.classList.remove("hidden");
    timerElement.classList.add("hidden");
    manualElement.classList.add("hidden");
    stopButton.classList.add("hidden");
    return;
  }

  renderCurrent(current, settings);
}

function renderCurrent(entry, settings = currentSettings) {
  currentEntry = entry;
  currentSettings = settings || currentSettings;
  window.clearInterval(clockTimer);

  if (!entry) {
    timerElement.classList.add("hidden");
    stopButton.classList.add("hidden");

    if (currentSettings?.togglConfigured) {
      emptyElement.classList.add("hidden");
      renderManualDefaults(currentSettings);
      manualElement.classList.remove("hidden");
      window.setTimeout(() => manualDescriptionInput.focus(), 0);
    } else {
      manualElement.classList.add("hidden");
      emptyElement.textContent = "Open Settings and connect your Toggl account.";
      emptyElement.classList.remove("hidden");
    }
    return;
  }

  descriptionElement.textContent = entry.description || "No description";
  billingElement.textContent = entry.billable ? "Billable" : "Non-billable";
  billingElement.classList.toggle("nonbillable", !entry.billable);
  billingElement.classList.remove("hidden");
  timerElement.classList.remove("hidden");
  manualElement.classList.add("hidden");
  stopButton.classList.remove("hidden");
  emptyElement.classList.add("hidden");
  updateElapsed();
  clockTimer = window.setInterval(updateElapsed, 1000);
}

function renderManualDefaults(settings) {
  manualBillingElement.textContent = settings.billable ? "Billable" : "Non-billable";
  manualBillingElement.classList.toggle("billable", settings.billable === true);

  const project = settings.projectName
    ? `Project: ${settings.projectName}`
    : settings.projectId
      ? `Project ID: ${settings.projectId}`
      : "No fixed project";
  const jiraNote = settings.jiraConfigured
    ? "You can also start a timer directly from a Jira issue."
    : "Jira integration is optional for manual timers.";
  const worklogNote = settings.syncWorklogs
    ? "Work Logs apply only to timers started from the Jira button."
    : "Jira Work Log sync is off.";
  manualContextElement.textContent = `${project}. ${jiraNote} ${worklogNote}`;
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
    title.textContent = `${record.issueKey || "Jira issue"} · ${formatDuration(record.durationSeconds)}`;
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
  showWorklogResult(response.data?.previousWorklogSync, true);

  if (response.data?.entry) {
    renderCurrent(response.data.entry, currentSettings);
    await refreshWorklogSummary();
    return;
  }

  await loadState();
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

  renderCurrent(null, currentSettings);
  renderWorklogs(response.data?.worklogs || currentWorklogs);
  showWorklogResult(response.data?.worklogSync, false);
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

async function refreshWorklogSummary() {
  const response = await sendMessage({ type: "GET_POPUP_STATE" });
  if (response.ok) {
    renderWorklogs(response.data?.worklogs);
  }
}

function showWorklogResult(result, previousTimer) {
  if (!result || ["not-applicable", "disabled"].includes(result.status)) {
    if (!previousTimer) {
      setNotice("Timer stopped in Toggl.", "success");
    }
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

function formatDuration(value) {
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
