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

  focus() {}
}

function createPopupHarness({ clipboardWrite } = {}) {
  const elements = new Map();
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
      createElement: () => new FakeElement()
    },
    window: {
      setTimeout: () => 0,
      setInterval: () => 0,
      clearInterval: () => undefined
    },
    navigator: {
      clipboard: {
        writeText: clipboardWrite || (() => Promise.resolve())
      }
    },
    chrome: {
      runtime: {
        openOptionsPage: () => Promise.resolve(),
        sendMessage: () => new Promise(() => undefined)
      }
    }
  });

  vm.runInContext(SOURCE, context, { filename: "popup.js" });
  return { context, elements, getElement };
}

test("formats compact Worked today durations", () => {
  const { context } = createPopupHarness();
  assert.equal(context.formatWorkedDuration(35 * 60), "35m");
  assert.equal(context.formatWorkedDuration((2 * 60 + 5) * 60), "2h 05m");
  assert.equal(context.formatWorkedDuration((12 * 60 + 30) * 60), "12h 30m");
  assert.equal(context.formatWorkedDuration(0), "0m");
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
  const total = context.getLiveWorkedTodaySeconds({
    status: "ok",
    totalSeconds: 3600,
    runningEntryId: 91,
    calculatedAt: new Date(calculatedAt).toISOString()
  }, calculatedAt + 125_000);

  assert.equal(total, 3725);
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

test("prefers Jira remaining estimate for the left value", () => {
  const { context } = createPopupHarness();
  const lines = context.getJiraProgressLines({
    loggedSeconds: 18000,
    originalEstimateSeconds: 28800,
    remainingEstimateSeconds: 5400
  });
  assert.equal(lines.summary, "5h logged / 8h original");
  assert.equal(lines.detail, "1h 30m left");
});

test("copies Jira Markdown and shows success feedback", async () => {
  const writes = [];
  const { context, getElement } = createPopupHarness({
    clipboardWrite: async (value) => writes.push(value)
  });
  context.renderJira({
    status: "ok",
    issueKey: "ECP-3217",
    loggedSeconds: 60,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    clipboardText: "Title:\n```text\n[ECP-3217] Example\n```"
  });

  await context.copyJiraDetails();

  assert.deepEqual(writes, ["Title:\n```text\n[ECP-3217] Example\n```"]);
  assert.equal(getElement("copy-status").textContent, "Copied to clipboard");
  assert.equal(getElement("copy-jira").disabled, false);
});

test("shows an actionable state when the Jira clipboard write fails", async () => {
  const { context, getElement } = createPopupHarness({
    clipboardWrite: async () => {
      throw new Error("denied");
    }
  });
  context.renderJira({
    status: "ok",
    issueKey: "ECP-3217",
    loggedSeconds: 60,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    clipboardText: "clipboard document"
  });

  await context.copyJiraDetails();

  assert.match(getElement("copy-status").textContent, /Check clipboard access and try again/);
  assert.equal(getElement("copy-status").classList.contains("error-state"), true);
  assert.equal(getElement("copy-jira").disabled, false);
});
