"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const ISSUE_URL = "https://team-example.atlassian.net/browse/PROJ-123";

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

  contains(name) {
    return this.values.has(name);
  }

  sync() {
    this.element.className = [...this.values].join(" ");
  }
}

class FakeElement {
  constructor(tagName = "div", ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.id = "";
    this.style = {};
    this.dataset = {};
    this.className = "";
    this.classList = new FakeClassList(this);
    this.listeners = new Map();
    this.children = [];
    this.disabled = false;
    this.textContent = "";
    this.innerHTML = "";
    this.title = "";
    this.parentNode = null;
    this.shadowRoot = null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument?.register(child);
    return child;
  }

  attachShadow() {
    this.shadowRoot = new FakeShadowRoot(this.ownerDocument);
    return this.shadowRoot;
  }

  remove() {
    this.ownerDocument?.nodes.delete(this.id);
  }

  async click() {
    this.listeners.get("click")?.({ currentTarget: this, target: this });
    await flushTasks();
  }
}

class FakeShadowRoot {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.elements = new Map();
    this.html = "";
  }

  set innerHTML(value) {
    this.html = String(value);
    for (const match of this.html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
      const element = new FakeElement(match[1], this.ownerDocument);
      element.id = match[2];
      this.elements.set(element.id, element);
    }
  }

  get innerHTML() {
    return this.html;
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }
}

class FakeDocument {
  constructor() {
    this.nodes = new Map();
    this.listeners = new Map();
    this.body = new FakeElement("body", this);
    this.documentElement = new FakeElement("html", this);
    this.title = "[PROJ-123] Improve onboarding - Jira";
    this.visibilityState = "visible";
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this.nodes.get(id) || null;
  }

  querySelectorAll() {
    return [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, target: this.body });
    }
  }

  register(element) {
    if (element.id) this.nodes.set(element.id, element);
  }
}

async function flushTasks() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function createHarness({
  position = "bottom-right",
  positions = null,
  clipboardWrite,
  clipboardResponses = []
} = {}) {
  const document = new FakeDocument();
  const messages = [];
  const clipboardWrites = [];
  const timeouts = new Map();
  let nextTimeoutId = 1;
  const windowListeners = new Map();
  const positionResponses = Array.isArray(positions) && positions.length > 0
    ? [...positions]
    : [position];
  const window = {
    location: new URL(ISSUE_URL),
    setInterval: () => 0,
    setTimeout(callback, delay) {
      const timeoutId = nextTimeoutId++;
      timeouts.set(timeoutId, { callback, delay });
      return timeoutId;
    },
    clearTimeout(timeoutId) {
      timeouts.delete(timeoutId);
    },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    }
  };
  window.top = window;

  const context = vm.createContext({
    AbortController,
    Date,
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    Math,
    MutationObserver: class { observe() {} },
    Promise,
    Response,
    URL,
    chrome: {
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          if (message.type === "GET_JIRA_UI_SETTINGS") {
            const nextPosition = positionResponses.length > 1
              ? positionResponses.shift()
              : positionResponses[0];
            return { ok: true, data: { floatingButtonPosition: nextPosition } };
          }
          if (message.type === "GET_JIRA_CLIPBOARD") {
            if (clipboardResponses.length > 0) {
              return clipboardResponses.shift();
            }
            return { ok: true, data: { clipboardText: "Prepared Jira document" } };
          }
          return {
            ok: true,
            data: {
              configured: true,
              isCurrentIssue: false,
              description: "[PROJ-123] Improve onboarding"
            }
          };
        }
      }
    },
    console,
    document,
    fetch: async () => jsonResponse({
      key: "PROJ-123",
      fields: { summary: "Improve onboarding" }
    }),
    navigator: {
      clipboard: {
        async writeText(value) {
          if (clipboardWrite) return clipboardWrite(value);
          clipboardWrites.push(value);
        }
      }
    },
    window
  });

  vm.runInContext(SOURCE, context, { filename: "content.js" });
  await flushTasks();
  const host = document.getElementById("jira-toggl-quickstart-root");
  return {
    clipboardWrites,
    document,
    host,
    messages,
    windowListeners,
    async runTimeouts(delay) {
      const due = [...timeouts.entries()]
        .filter(([, timeout]) => timeout.delay === delay);
      for (const [timeoutId, timeout] of due) {
        timeouts.delete(timeoutId);
        timeout.callback();
      }
      await flushTasks();
    }
  };
}

test("anchors the Jira action group in every configured corner", async () => {
  const expected = {
    "top-left": { top: "24px", right: "auto", bottom: "auto", left: "24px" },
    "top-right": { top: "24px", right: "24px", bottom: "auto", left: "auto" },
    "bottom-left": { top: "auto", right: "auto", bottom: "24px", left: "24px" },
    "bottom-right": { top: "auto", right: "24px", bottom: "24px", left: "auto" }
  };

  for (const [position, anchors] of Object.entries(expected)) {
    const { host } = await createHarness({ position });
    assert.equal(host.dataset.position, position);
    for (const [property, value] of Object.entries(anchors)) {
      assert.equal(host.style[property], value, `${position} ${property}`);
    }
  }

  const { host } = await createHarness({ position: "middle" });
  assert.equal(host.dataset.position, "bottom-right");
});

test("applies a changed floating position when the Jira tab becomes visible", async () => {
  const harness = await createHarness({
    positions: ["bottom-right", "top-left"]
  });
  assert.equal(harness.host.dataset.position, "bottom-right");

  harness.document.dispatch("visibilitychange");
  await flushTasks();

  assert.equal(harness.host.dataset.position, "top-left");
});

test("prefetches Jira details and copies them immediately from the adjacent action", async () => {
  const { clipboardWrites, host, messages } = await createHarness();
  const copyButton = host.shadowRoot.getElementById("copy-jira");

  assert.ok(messages.some((message) =>
    message.type === "GET_JIRA_CLIPBOARD" && message.issueKey === "PROJ-123"
  ));
  await copyButton.click();

  assert.deepEqual(clipboardWrites, ["Prepared Jira document"]);
  assert.equal(host.shadowRoot.getElementById("message").textContent, "Copied Jira title & description.");
  assert.equal(copyButton.classList.contains("copied"), true);
  assert.match(host.shadowRoot.innerHTML, /@keyframes copy-success/);
  assert.match(host.shadowRoot.innerHTML, /prefers-reduced-motion:\s*reduce/);
  assert.equal(host.shadowRoot.getElementById("toggle").disabled, false);
});

test("reports clipboard failures without disabling the timer action", async () => {
  const { host } = await createHarness({
    clipboardWrite: async () => {
      throw new Error("denied");
    }
  });

  await host.shadowRoot.getElementById("copy-jira").click();

  assert.match(host.shadowRoot.getElementById("message").textContent, /Could not copy/i);
  assert.equal(host.shadowRoot.getElementById("toggle").disabled, false);
  assert.equal(host.shadowRoot.getElementById("copy-jira").disabled, false);
  assert.equal(host.shadowRoot.getElementById("copy-jira").classList.contains("copied"), false);
});

test("keeps a failed clipboard prefetch reachable and retries from the button", async () => {
  const clipboardResponses = [
    { ok: false, error: { message: "Jira was temporarily unavailable." } },
    { ok: true, data: { clipboardText: "Fresh Jira document" } }
  ];
  const { clipboardWrites, host, messages } = await createHarness({ clipboardResponses });
  const copyButton = host.shadowRoot.getElementById("copy-jira");
  const copyLabel = host.shadowRoot.getElementById("copy-label");

  assert.equal(copyButton.disabled, false);
  assert.equal(copyLabel.textContent, "Retry");
  assert.match(copyButton.title, /temporarily unavailable/i);

  await copyButton.click();
  assert.equal(messages.filter((message) => message.type === "GET_JIRA_CLIPBOARD").length, 2);
  assert.equal(copyButton.disabled, false);
  assert.equal(copyLabel.textContent, "Copy");
  assert.match(host.shadowRoot.getElementById("message").textContent, /ready.*click Copy/i);

  await copyButton.click();
  assert.deepEqual(clipboardWrites, ["Fresh Jira document"]);
});

test("refreshes prefetched Jira copy text after an issue edit", async () => {
  const clipboardResponses = [
    { ok: true, data: { clipboardText: "Original Jira document" } },
    { ok: true, data: { clipboardText: "Edited Jira document" } }
  ];
  const harness = await createHarness({ clipboardResponses });

  harness.document.dispatch("input");
  await harness.runTimeouts(1500);
  await harness.host.shadowRoot.getElementById("copy-jira").click();

  assert.equal(
    harness.messages.filter((message) => message.type === "GET_JIRA_CLIPBOARD").length,
    2
  );
  assert.deepEqual(harness.clipboardWrites, ["Edited Jira document"]);
});

test("ignores an older Jira copy response that resolves after a newer refresh", async () => {
  let resolveOlderRefresh;
  const olderRefresh = new Promise((resolve) => {
    resolveOlderRefresh = resolve;
  });
  const harness = await createHarness({
    clipboardResponses: [
      { ok: true, data: { clipboardText: "Initial Jira document" } },
      olderRefresh,
      { ok: true, data: { clipboardText: "Newest Jira document" } }
    ]
  });

  harness.document.dispatch("input");
  await harness.runTimeouts(1500);
  harness.document.dispatch("input");
  await harness.runTimeouts(1500);
  resolveOlderRefresh({
    ok: true,
    data: { clipboardText: "Stale Jira document" }
  });
  await flushTasks();
  await harness.host.shadowRoot.getElementById("copy-jira").click();

  assert.deepEqual(harness.clipboardWrites, ["Newest Jira document"]);
});
