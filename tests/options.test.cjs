"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "options.js"), "utf8");
const TOGGL_ACCOUNTS_MATCH = "https://accounts.toggl.com/*";
const TOGGL_TRACK_WEB_MATCH = "https://track.toggl.com/*";

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
    if (force) this.values.add(name);
    else this.values.delete(name);
    this.sync();
  }

  sync() {
    this.element.className = [...this.values].join(" ");
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.checked = false;
    this.className = "";
    this.disabled = false;
    this.listeners = new Map();
    this.open = false;
    this.textContent = "";
    this.value = "";
    this.classList = new FakeClassList(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  focus() {}
  reset() {}
  setSelectionRange() {}
}

function optionsState(overrides = {}) {
  return {
    configured: false,
    togglConfigured: false,
    jiraConfigured: false,
    hasApiToken: false,
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
    floatingButtonPosition: "bottom-right",
    pendingWorklogCount: 0,
    ...overrides
  };
}

function createOptionsHarness({
  permissionGranted = true,
  connectResponse,
  initialState = optionsState()
} = {}) {
  const elements = new Map();
  const messages = [];
  const permissionRequests = [];
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };

  const context = vm.createContext({
    URL,
    console,
    document: {
      getElementById: getElement,
      querySelectorAll: () => []
    },
    window: { confirm: () => true },
    chrome: {
      permissions: {
        async request(request) {
          permissionRequests.push(structuredClone(request));
          return permissionGranted;
        },
        async remove() {
          return true;
        }
      },
      runtime: {
        async sendMessage(message) {
          messages.push(structuredClone(message));
          if (message.type === "GET_OPTIONS_STATE") {
            return { ok: true, data: initialState };
          }
          return connectResponse;
        }
      }
    }
  });

  vm.runInContext(SOURCE, context, { filename: "options.js" });
  return { context, getElement, messages, permissionRequests };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("denied Toggl connection access stops before the worker connection", async () => {
  const harness = createOptionsHarness({ permissionGranted: false });
  await flushTasks();

  await harness.context.connectToggl();

  assert.deepEqual(harness.permissionRequests, [
    { origins: [TOGGL_ACCOUNTS_MATCH, TOGGL_TRACK_WEB_MATCH] }
  ]);
  assert.deepEqual(harness.messages.map((message) => message.type), ["GET_OPTIONS_STATE"]);
  assert.match(harness.getElement("status").textContent, /not granted/i);
});

test("a missing Toggl session presents an explicit retry action", async () => {
  const harness = createOptionsHarness({
    connectResponse: {
      ok: false,
      error: {
        code: "TOGGL_LOGIN_REQUIRED",
        message: "Log in to Toggl in the opened tab, then click Connect Toggl again."
      }
    }
  });
  await flushTasks();

  await harness.context.connectToggl();

  assert.equal(harness.getElement("connect-toggl").textContent, "Retry connection");
  assert.match(harness.getElement("status").textContent, /log in to Toggl/i);
});

test("a missing Toggl Track profile session presents an explicit retry action", async () => {
  const harness = createOptionsHarness({
    connectResponse: {
      ok: false,
      error: {
        code: "TOGGL_TRACK_SESSION_REQUIRED",
        message: "Finish opening Toggl Track in the new tab, then retry the connection."
      }
    }
  });
  await flushTasks();

  await harness.context.connectToggl();

  assert.equal(harness.getElement("connect-toggl").textContent, "Retry connection");
  assert.match(harness.getElement("status").textContent, /opening Toggl Track/i);
});

test("a successful Toggl connection preserves unsaved Jira form values", async () => {
  const harness = createOptionsHarness({
    connectResponse: {
      ok: true,
      data: optionsState({
        togglConfigured: true,
        hasApiToken: true,
        workspaceId: 321,
        profileName: "Session User"
      })
    }
  });
  await flushTasks();
  harness.getElement("jira-origin").value = "https://draft.atlassian.net";

  await harness.context.connectToggl();

  assert.equal(harness.getElement("jira-origin").value, "https://draft.atlassian.net");
  assert.equal(harness.getElement("workspace-id").value, 321);
  assert.equal(harness.getElement("toggl-account-state").textContent, "Connected as Session User");
  assert.equal(harness.getElement("connect-toggl").textContent, "Reconnect Toggl");
  assert.deepEqual(harness.messages.map((message) => message.type), [
    "GET_OPTIONS_STATE",
    "CONNECT_TOGGL"
  ]);
  assert.doesNotMatch(JSON.stringify(harness.messages), /apiToken|api_token/);
});

test("reconnecting an already configured account does not ask to finish setup again", async () => {
  const configured = optionsState({
    configured: true,
    togglConfigured: true,
    jiraConfigured: true,
    hasApiToken: true,
    jiraOrigin: "https://team.atlassian.net",
    workspaceId: 321,
    workspaceName: "Workspace QA",
    profileName: "Session User"
  });
  const harness = createOptionsHarness({
    initialState: configured,
    connectResponse: { ok: true, data: configured }
  });
  await flushTasks();

  await harness.context.connectToggl();

  assert.match(harness.getElement("status").textContent, /settings remain ready/i);
  assert.doesNotMatch(harness.getElement("status").textContent, /finish setup/i);
});

test("settings removal surfaces a Toggl permission cleanup warning", async () => {
  const warning = "Settings were removed, but Chrome could not remove Toggl site access.";
  const harness = createOptionsHarness({
    connectResponse: {
      ok: true,
      data: { cleared: true, permissionCleanupWarning: warning }
    }
  });
  await flushTasks();

  await harness.context.clearSettings();

  assert.equal(harness.getElement("status").textContent, warning);
  assert.match(harness.getElement("status").className, /error/);
});
