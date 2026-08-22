"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
    this.sync();
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
    this.sync();
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    this.sync();
    return enabled;
  }

  contains(name) {
    return this.values.has(name);
  }

  sync() {
    this.element.className = [...this.values].join(" ");
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.className = "";
    this.disabled = false;
    this.value = "";
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {}
}

function createPopupHarness({ runtimeSendMessage } = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const runtimeListeners = new Map();
  const windowListeners = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };

  const context = vm.createContext({
    console,
    Date,
    Math,
    Number,
    String,
    Promise,
    document: {
      getElementById: getElement,
      createElement: () => new FakeElement(),
      visibilityState: "visible",
      addEventListener(type, listener) {
        documentListeners.set(type, listener);
      }
    },
    window: {
      setTimeout: () => 0,
      setInterval: () => 0,
      clearInterval: () => undefined,
      addEventListener(type, listener) {
        windowListeners.set(type, listener);
      }
    },
    chrome: {
      runtime: {
        openOptionsPage: () => Promise.resolve(),
        sendMessage: runtimeSendMessage || (() => new Promise(() => undefined)),
        onMessage: {
          addListener(listener) {
            runtimeListeners.set("message", listener);
          }
        }
      }
    }
  });

  vm.runInContext(SOURCE, context, { filename: "popup.js" });
  return {
    context,
    documentListeners,
    elements,
    getElement,
    runtimeListeners,
    windowListeners
  };
}

function findByClass(element, className) {
  if (
    element.classList?.contains(className) ||
    String(element.className || "").split(/\s+/).includes(className)
  ) return element;
  for (const child of element.children || []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return null;
}

async function flushTasks() {
  for (let index = 0; index < 3; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("formats compact Worked today durations", () => {
  const { context } = createPopupHarness();
  assert.equal(context.formatWorkedDuration(35 * 60), "35m");
  assert.equal(context.formatWorkedDuration((2 * 60 + 5) * 60), "2h 05m");
  assert.equal(context.formatWorkedDuration((12 * 60 + 30) * 60), "12h 30m");
  assert.equal(context.formatWorkedDuration(0), "0m");
});

test("persistent refreshes do not steal focus into the manual timer form", () => {
  assert.doesNotMatch(
    SOURCE,
    /window\.setTimeout\(\(\) => manualDescriptionInput\.focus\(\), 0\)/
  );
});

test("increments a running Worked today value locally after the initial request", () => {
  const { context } = createPopupHarness();
  context.renderCurrent({
    id: 91,
    description: "Running",
    start: "2026-08-20T10:00:00Z",
    stop: null,
    billable: false
  }, { togglConfigured: true, projectId: 456 });

  const calculatedAt = Date.parse("2026-08-20T10:30:00Z");
  const total = context.getLiveWorkedSeconds({
    status: "ok",
    totalSeconds: 3600,
    runningEntryId: 91,
    calculatedAt: new Date(calculatedAt).toISOString()
  }, "totalSeconds", calculatedAt + 125_000);

  assert.equal(total, 3725);
});

test("renders and advances the current Monday-to-Sunday total beside today", () => {
  const { context, getElement } = createPopupHarness();
  context.renderCurrent({
    id: 91,
    description: "Running",
    start: "2026-08-20T10:00:00Z",
    stop: null,
    billable: false
  }, { togglConfigured: true, projectId: 456 });

  const calculatedAt = Date.parse("2026-08-20T10:30:00Z");
  const summary = {
    status: "ok",
    totalSeconds: 3600,
    weekTotalSeconds: 10800,
    runningEntryId: null,
    calculatedAt: new Date(calculatedAt).toISOString()
  };
  context.renderWorkedToday(summary);

  assert.equal(getElement("worked-today-value").textContent, "1h");
  assert.equal(getElement("worked-week-value").textContent, "3h");
  assert.equal(
    context.getLiveWorkedSeconds(
      { ...summary, runningEntryId: 91 },
      "weekTotalSeconds",
      calculatedAt + 125_000
    ),
    10925
  );
});

test("shows Jira progress below the original estimate", () => {
  const { context } = createPopupHarness();
  const lines = context.getJiraProgressLines({
    loggedSeconds: 19800,
    originalEstimateSeconds: 28800,
    remainingEstimateSeconds: null
  });
  assert.equal(lines.summary, "5h 30m logged / 8h original");
  assert.equal(lines.detail, "2h 30m left");
});

test("shows Jira progress exactly at the original estimate", () => {
  const { context } = createPopupHarness();
  const lines = context.getJiraProgressLines({
    loggedSeconds: 28800,
    originalEstimateSeconds: 28800,
    remainingEstimateSeconds: null
  });
  assert.equal(lines.summary, "8h logged / 8h original");
  assert.equal(lines.detail, "0m left");
});

test("shows a positive Jira overrun without clamping the business value", () => {
  const { context } = createPopupHarness();
  const lines = context.getJiraProgressLines({
    loggedSeconds: 36000,
    originalEstimateSeconds: 28800,
    remainingEstimateSeconds: 0
  });
  assert.equal(lines.summary, "10h logged / 8h original");
  assert.equal(lines.detail, "2h over estimate");
});

test("shows logged Jira time when there is no original estimate", () => {
  const { context } = createPopupHarness();
  const lines = context.getJiraProgressLines({
    loggedSeconds: 19800,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null
  });
  assert.equal(lines.summary, "5h 30m logged");
  assert.equal(lines.detail, "No original estimate");
});

test("shows zero logged and the full amount left when Jira has no logged time", () => {
  const { context } = createPopupHarness();
  const lines = context.getJiraProgressLines({
    loggedSeconds: 0,
    originalEstimateSeconds: 28800,
    remainingEstimateSeconds: null
  });
  assert.equal(lines.summary, "0m logged / 8h original");
  assert.equal(lines.detail, "8h left");
});

test("derives Jira time left from original minus logged time", () => {
  const { context } = createPopupHarness();
  const lines = context.getJiraProgressLines({
    loggedSeconds: 18000,
    originalEstimateSeconds: 28800,
    remainingEstimateSeconds: 5400
  });
  assert.equal(lines.summary, "5h logged / 8h original");
  assert.equal(lines.detail, "3h left");
});

test("renders today's appointments with totals and a disabled running action", () => {
  const { context, getElement } = createPopupHarness();
  const calculatedAt = Date.now();
  context.renderCurrent({
    id: 106,
    description: "Customer onboarding",
    start: "2026-08-20T11:30:00Z",
    duration: -1
  }, { togglConfigured: true });
  context.renderAppointments({
    status: "ok",
    calculatedAt: new Date(calculatedAt).toISOString(),
    appointments: [
      {
        sourceEntryId: 106,
        issueKey: "PROJ-123",
        description: "Customer onboarding",
        totalSeconds: 7200,
        runningEntryId: 106
      },
      {
        sourceEntryId: 103,
        issueKey: null,
        description: "Review docs",
        totalSeconds: 1800,
        runningEntryId: null
      }
    ]
  });

  const list = getElement("appointments-list");
  assert.equal(list.children.length, 2);
  assert.equal(findByClass(list.children[0], "appointment-title").textContent, "Customer onboarding");
  assert.equal(findByClass(list.children[0], "appointment-duration").textContent, "2h");
  const runningButton = findByClass(list.children[0], "appointment-play");
  assert.equal(runningButton.textContent, "Running");
  assert.equal(runningButton.disabled, true);
  assert.match(runningButton.getAttribute("aria-label"), /PROJ-123.*running/i);
  assert.equal(findByClass(list.children[1], "appointment-duration").textContent, "30m");

  assert.equal(
    context.getLiveAppointmentSeconds(
      { totalSeconds: 7200, runningEntryId: 106 },
      { calculatedAt: new Date(calculatedAt).toISOString() },
      calculatedAt + 125_000
    ),
    7325
  );
});

test("plays an appointment by source ID and reloads the side panel state", async () => {
  const messages = [];
  const state = {
    settings: { hasApiToken: true, togglConfigured: true, workspaceName: "QA" },
    current: null,
    workedToday: { status: "ok", totalSeconds: 0, weekTotalSeconds: 0, appointments: [] },
    jira: { status: "not-applicable" },
    worklogs: { pendingCount: 0, pending: [] }
  };
  const { context, getElement } = createPopupHarness({
    runtimeSendMessage: async (message) => {
      messages.push(message);
      if (message.type === "START_TODAY_APPOINTMENT") {
        return { ok: true, data: { action: "started", stoppedPrevious: false } };
      }
      return { ok: true, data: state };
    }
  });
  context.renderAppointments({
    status: "ok",
    appointments: [{
      sourceEntryId: 103,
      issueKey: null,
      description: "Review docs",
      totalSeconds: 1800,
      runningEntryId: null
    }]
  });

  await context.startTodayAppointment(0);

  assert.ok(messages.some((message) =>
    message.type === "START_TODAY_APPOINTMENT" && message.sourceEntryId === 103
  ));
  assert.ok(messages.filter((message) => message.type === "GET_POPUP_STATE").length >= 1);
  assert.match(getElement("notice").textContent, /started/i);
});

test("keeps appointment controls available when replay fails", async () => {
  const { context, getElement } = createPopupHarness({
    runtimeSendMessage: async (message) => message.type === "START_TODAY_APPOINTMENT"
      ? { ok: false, error: { message: "The selected appointment is unavailable." } }
      : new Promise(() => undefined)
  });
  context.renderAppointments({
    status: "ok",
    appointments: [{
      sourceEntryId: 103,
      issueKey: null,
      description: "Review docs",
      totalSeconds: 1800,
      runningEntryId: null
    }]
  });

  await context.startTodayAppointment(0);

  assert.match(getElement("error").textContent, /unavailable/i);
  assert.equal(findByClass(getElement("appointments-list").children[0], "appointment-play").disabled, false);
});

test("refreshes persistent side panel state when it regains focus", async () => {
  let stateRequests = 0;
  const state = {
    settings: { hasApiToken: false },
    current: null,
    workedToday: { status: "not-configured" },
    jira: { status: "not-applicable" },
    worklogs: { pendingCount: 0, pending: [] }
  };
  const { windowListeners } = createPopupHarness({
    runtimeSendMessage: async (message) => {
      if (message.type === "GET_POPUP_STATE") stateRequests += 1;
      return { ok: true, data: state };
    }
  });
  await flushTasks();
  const initialRequests = stateRequests;

  windowListeners.get("focus")();
  await flushTasks();

  assert.ok(initialRequests >= 1);
  assert.equal(stateRequests, initialRequests + 1);
});

test("refreshes persistent side panel state after an external timer mutation", async () => {
  let stateRequests = 0;
  const state = {
    settings: { hasApiToken: false },
    current: null,
    workedToday: { status: "not-configured" },
    jira: { status: "not-applicable" },
    worklogs: { pendingCount: 0, pending: [] }
  };
  const { runtimeListeners } = createPopupHarness({
    runtimeSendMessage: async () => {
      stateRequests += 1;
      return { ok: true, data: state };
    }
  });
  await flushTasks();
  const initialRequests = stateRequests;

  runtimeListeners.get("message")({ type: "SIDE_PANEL_STATE_CHANGED" });
  await flushTasks();

  assert.equal(stateRequests, initialRequests + 1);
});
