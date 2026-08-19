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
const emptyElement = document.getElementById("empty");
const errorElement = document.getElementById("error");
const stopButton = document.getElementById("stop");
const settingsButton = document.getElementById("settings");

let currentEntry = null;
let currentSettings = null;
let clockTimer = null;

settingsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

stopButton.addEventListener("click", () => {
  void stopTimer();
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
    setError(response.error?.message || "Could not check Toggl.");
    return;
  }

  const { settings, current } = response.data;
  currentSettings = settings;
  workspaceElement.textContent = settings.togglConfigured
    ? settings.workspaceName || `Workspace ${settings.workspaceId}`
    : "Toggl is not configured";

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
  manualContextElement.textContent = `${project}. ${jiraNote}`;
}

async function startManualTimer() {
  const description = manualDescriptionInput.value.replace(/\s+/g, " ").trim();

  if (!description) {
    setError("Enter a description before starting the timer.");
    manualDescriptionInput.focus();
    return;
  }

  setError("");
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

  if (response.data?.entry) {
    renderCurrent(response.data.entry, currentSettings);
    return;
  }

  await loadState();
}

async function stopTimer() {
  stopButton.disabled = true;
  stopButton.textContent = "Stopping…";
  const response = await sendMessage({ type: "STOP_CURRENT_TIMER" });
  stopButton.disabled = false;
  stopButton.textContent = "Stop timer";

  if (!response.ok) {
    setError(response.error?.message || "Could not stop the timer.");
    return;
  }

  setError("");
  renderCurrent(null, currentSettings);
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
