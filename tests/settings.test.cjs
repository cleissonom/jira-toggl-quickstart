"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const BACKGROUND_SOURCE = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
const STORAGE_KEY = "jiraTogglSettings";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const JIRA_ORIGIN = "https://team-example.atlassian.net";
const JIRA_MATCH = `${JIRA_ORIGIN}/*`;

function jsonResponse(payload, status = 200) {
  return new Response(payload === undefined ? "" : JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createHarness({ initialSettings = null, permissions = [JIRA_MATCH] } = {}) {
  const storage = {};
  if (initialSettings) {
    storage[STORAGE_KEY] = structuredClone(initialSettings);
  }
  const permissionOrigins = new Set(permissions);
  const registeredScripts = new Map();
  const fetchQueue = [];
  const requests = [];
  const listeners = {};

  const chrome = {
    action: {
      async setIcon() {}
    },
    sidePanel: {
      async setPanelBehavior() {}
    },
    storage: {
      local: {
        async setAccessLevel() {},
        async get(key) {
          if (typeof key === "string") {
            return Object.hasOwn(storage, key)
              ? { [key]: structuredClone(storage[key]) }
              : {};
          }
          return structuredClone(storage);
        },
        async set(value) {
          Object.assign(storage, structuredClone(value));
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storage[key];
          }
        }
      }
    },
    runtime: {
      id: EXTENSION_ID,
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onStartup: { addListener(listener) { listeners.startup = listener; } },
      onMessage: { addListener(listener) { listeners.message = listener; } },
      async sendMessage() {},
      async openOptionsPage() {}
    },
    permissions: {
      onAdded: { addListener(listener) { listeners.permissionAdded = listener; } },
      onRemoved: { addListener(listener) { listeners.permissionRemoved = listener; } },
      async contains({ origins = [] }) {
        return origins.every((origin) => permissionOrigins.has(origin));
      },
      async remove({ origins = [] }) {
        let removed = false;
        for (const origin of origins) {
          removed = permissionOrigins.delete(origin) || removed;
        }
        return removed;
      }
    },
    scripting: {
      async getRegisteredContentScripts({ ids } = {}) {
        const values = [...registeredScripts.values()].map(structuredClone);
        return ids?.length ? values.filter((item) => ids.includes(item.id)) : values;
      },
      async registerContentScripts(scripts) {
        for (const script of scripts) {
          registeredScripts.set(script.id, structuredClone(script));
        }
      },
      async updateContentScripts(scripts) {
        for (const script of scripts) {
          registeredScripts.set(script.id, {
            ...(registeredScripts.get(script.id) || {}),
            ...structuredClone(script)
          });
        }
      },
      async unregisterContentScripts({ ids } = {}) {
        for (const id of ids || [...registeredScripts.keys()]) {
          registeredScripts.delete(id);
        }
      }
    }
  };

  async function fetchMock(url, options = {}) {
    requests.push({
      url: String(url),
      method: options.method || "GET",
      headers: { ...(options.headers || {}) },
      body: options.body || null,
      credentials: options.credentials || null,
      cache: options.cache || null
    });
    if (fetchQueue.length === 0) {
      throw new Error(`Missing mock response for ${options.method || "GET"} ${url}`);
    }
    const next = fetchQueue.shift();
    return typeof next === "function" ? next(url, options) : next;
  }

  const context = vm.createContext({
    chrome,
    fetch: fetchMock,
    Response,
    URL,
    btoa,
    console,
    structuredClone,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: "background.js" });

  return { context, storage, fetchQueue, requests, registeredScripts };
}

function settingsInput(overrides = {}) {
  return {
    jiraOrigin: JIRA_ORIGIN,
    apiToken: "test-token",
    workspaceId: "",
    projectId: "",
    billable: false,
    descriptionTemplate: "[{key}] {summary}",
    stopExisting: true,
    syncWorklogs: false,
    worklogSyncMode: "automatic",
    worklogRounding: "nearest-minute",
    worklogCommentTemplate: "Synced from Toggl: {description}",
    floatingButtonPosition: "bottom-right",
    ...overrides
  };
}

function savedSettings(overrides = {}) {
  return {
    apiToken: "test-token",
    jiraOrigin: JIRA_ORIGIN,
    workspaceId: 123,
    workspaceName: "Workspace QA",
    profileName: "Dev QA",
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
    ...overrides
  };
}

test("loads related Toggl data and auto-selects the active project with the highest actual_hours", async () => {
  const harness = createHarness();
  harness.fetchQueue.push(
    jsonResponse({
      default_workspace_id: 123,
      fullname: "Dev QA",
      projects: [
        { id: 10, name: "Low", active: true, actual_hours: 2, workspace_id: 123 },
        { id: 11, name: "Winner", active: true, actual_hours: 18.5, workspace_id: 123 },
        { id: 12, name: "Inactive", active: false, actual_hours: 999, workspace_id: 123 },
        { id: 13, name: "Other workspace", active: true, actual_hours: 1000, workspace_id: 456 }
      ]
    }),
    jsonResponse({ id: 123, name: "Workspace QA" }),
    jsonResponse(null)
  );

  const result = await harness.context.validateAndSaveSettings(settingsInput());

  assert.equal(harness.requests[0].url, "https://api.track.toggl.com/api/v9/me?with_related_data=true");
  assert.equal(harness.requests.length, 3, "auto-selection should only add the current-timer lookup");
  assert.equal(harness.requests[2].url, "https://api.track.toggl.com/api/v9/me/time_entries/current");
  assert.equal(result.projectId, 11);
  assert.equal(result.projectName, "Winner");
  assert.equal(result.projectConfigured, true);
  assert.equal(result.togglConfigured, true);
  assert.equal(harness.storage[STORAGE_KEY].projectId, 11);
});

test("auto-selection supports projects nested under related workspaces", async () => {
  const harness = createHarness();
  harness.fetchQueue.push(
    jsonResponse({
      default_workspace_id: 123,
      workspaces: [{
        id: 123,
        projects: [
          { id: 21, name: "Nested low", active: true, actual_hours: 1, wid: 123 },
          { id: 22, name: "Nested high", active: true, actual_hours: "9", wid: 123 }
        ]
      }]
    }),
    jsonResponse({ id: 123, name: "Workspace QA" })
  );

  const result = await harness.context.validateAndSaveSettings(settingsInput());
  assert.equal(result.projectId, 22);
  assert.equal(result.projectName, "Nested high");
});

test("an explicit optional project ID overrides automatic selection and remains API-validated", async () => {
  const harness = createHarness();
  harness.fetchQueue.push(
    jsonResponse({
      default_workspace_id: 123,
      projects: [{ id: 11, name: "Automatic", active: true, actual_hours: 99, workspace_id: 123 }]
    }),
    jsonResponse({ id: 123, name: "Workspace QA" }),
    jsonResponse({ id: 44, name: "Explicit", active: true, workspace_id: 123 })
  );

  const result = await harness.context.validateAndSaveSettings(
    settingsInput({ projectId: "44" })
  );

  assert.equal(result.projectId, 44);
  assert.equal(result.projectName, "Explicit");
  assert.match(harness.requests[2].url, /\/workspaces\/123\/projects\/44$/);
});

test("configuration remains usable when no active project is available", async () => {
  const harness = createHarness();
  harness.fetchQueue.push(
    jsonResponse({
      default_workspace_id: 123,
      projects: [
        { id: 31, name: "Inactive", active: false, actual_hours: 50, workspace_id: 123 },
        { id: 32, name: "Elsewhere", active: true, actual_hours: 80, workspace_id: 999 }
      ]
    }),
    jsonResponse({ id: 123, name: "Workspace QA" })
  );

  const result = await harness.context.validateAndSaveSettings(settingsInput());
  assert.equal(result.projectId, null);
  assert.equal(result.projectName, "");
  assert.equal(result.projectConfigured, false);
  assert.equal(result.togglConfigured, true);
  assert.equal(result.configured, true);
  assert.notEqual(result.configurationRequired, "project");
});

test("starting a timer without a selected project omits project_id", async () => {
  const harness = createHarness();
  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({ id: 8001, workspace_id: 123, description: "Projectless", duration: -1 })
  );

  await harness.context.startDescriptionTimer("Projectless", savedSettings(), null);
  const body = JSON.parse(harness.requests[1].body);
  assert.equal(Object.hasOwn(body, "project_id"), false);
  assert.equal(body.workspace_id, 123);
});

test("starting a timer still includes a manually or automatically selected project", async () => {
  const harness = createHarness();
  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({ id: 8002, workspace_id: 123, project_id: 44, description: "With project", duration: -1 })
  );

  await harness.context.startDescriptionTimer(
    "With project",
    savedSettings({ projectId: 44, projectName: "Explicit" }),
    null
  );
  const body = JSON.parse(harness.requests[1].body);
  assert.equal(body.project_id, 44);
});

test("a token and workspace are sufficient start configuration", () => {
  const harness = createHarness();
  assert.equal(harness.context.hasStartConfiguration(savedSettings()), true);
  const publicSettings = harness.context.toPublicSettings(savedSettings(), true);
  assert.equal(publicSettings.togglConfigured, true);
  assert.equal(publicSettings.projectConfigured, false);
  assert.equal(publicSettings.configurationRequired, "");
});

test("floating button position defaults safely and round-trips through settings", async () => {
  const legacyHarness = createHarness({
    initialSettings: savedSettings({ floatingButtonPosition: undefined })
  });
  const legacy = await legacyHarness.context.getSettings();
  assert.equal(legacy.floatingButtonPosition, "bottom-right");

  const invalidHarness = createHarness({
    initialSettings: savedSettings({ floatingButtonPosition: "middle" })
  });
  const invalid = await invalidHarness.context.getSettings();
  assert.equal(invalid.floatingButtonPosition, "bottom-right");
  assert.throws(
    () => invalidHarness.context.normalizeFloatingButtonPosition("middle"),
    /floating button position/i
  );

  const saveHarness = createHarness();
  saveHarness.fetchQueue.push(
    jsonResponse({ default_workspace_id: 123 }),
    jsonResponse({ id: 123, name: "Workspace QA" }),
    jsonResponse(null)
  );
  const saved = await saveHarness.context.validateAndSaveSettings(
    settingsInput({ floatingButtonPosition: "top-left" })
  );
  assert.equal(saved.floatingButtonPosition, "top-left");
  assert.equal(saveHarness.storage[STORAGE_KEY].floatingButtonPosition, "top-left");
});

test("legacy exact-second rounding migrates to nearest minute", async () => {
  const harness = createHarness({
    initialSettings: savedSettings({ worklogRounding: "exact" })
  });
  const settings = await harness.context.getSettings();
  assert.equal(settings.worklogRounding, "nearest-minute");
  assert.equal(harness.context.normalizeWorklogRounding("exact"), "nearest-minute");
});

test("Work Log rounding supports nearest minute and round up only", () => {
  const harness = createHarness();
  assert.equal(harness.context.applyWorklogRounding(89, "nearest-minute"), 60);
  assert.equal(harness.context.applyWorklogRounding(91, "nearest-minute"), 120);
  assert.equal(harness.context.applyWorklogRounding(61, "ceil-minute"), 120);
  assert.equal(harness.context.applyWorklogRounding(89, "exact"), 60);
});

test("synchronized Work Logs tell Jira to auto-adjust the remaining estimate", async () => {
  const harness = createHarness();
  harness.fetchQueue.push(jsonResponse({ id: "70001", timeSpentSeconds: 120 }));

  await harness.context.createJiraWorklog({
    togglEntryId: 9300,
    workspaceId: 123,
    issueKey: "PROJ-123",
    description: "[PROJ-123] Work",
    started: "2026-08-20T10:00:00Z",
    durationSeconds: 91
  }, savedSettings({
    syncWorklogs: true,
    worklogRounding: "nearest-minute",
    worklogCommentTemplate: ""
  }));

  assert.match(harness.requests[0].url, /adjustEstimate=auto/);
  assert.doesNotMatch(harness.requests[0].url, /adjustEstimate=leave/);
  assert.match(harness.requests[0].url, /notifyUsers=false/);
  assert.equal(harness.requests[0].credentials, "include");
  const body = JSON.parse(harness.requests[0].body);
  assert.equal(body.timeSpentSeconds, 120);
  assert.equal(body.started, "2026-08-20T10:00:00.000+0000");
});

test("settings UI removes exact seconds and marks Project ID optional", () => {
  const html = fs.readFileSync(path.join(ROOT, "options.html"), "utf8");
  assert.doesNotMatch(html, /Exact duration in seconds/);
  assert.doesNotMatch(html, /option value="exact"/);
  assert.match(html, /Toggl project ID <em>\(optional\)<\/em>/);
  assert.match(html, /highest\s+<code>actual_hours<\/code>/);
  const projectStart = html.indexOf('id="project-id"');
  const projectTagStart = html.lastIndexOf("<input", projectStart);
  const projectTagEnd = html.indexOf(">", projectStart);
  const projectTag = html.slice(projectTagStart, projectTagEnd + 1);
  assert.doesNotMatch(projectTag, /\brequired\b/);
});

test("settings UI explains automatic Jira remaining-estimate adjustment", () => {
  const html = fs.readFileSync(path.join(ROOT, "options.html"), "utf8");
  assert.match(html, /automatically reduces Jira's remaining estimate/);
  assert.doesNotMatch(html, /remaining estimate is always left unchanged/);
});

test("version 0.5.1 remains documented as a historical release", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), /## 0\.5\.1 — 2026-08-20/);
});

test("side panel is the only new required permission and remote-code policy stays unchanged", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  assert.deepEqual([...manifest.permissions].sort(), ["scripting", "sidePanel", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://api.track.toggl.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
  const html = ["options.html", "popup.html"]
    .map((name) => fs.readFileSync(path.join(ROOT, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc="(?:https?:)?\/\//i);
  const source = ["background.js", "content.js", "options.js", "popup.js"]
    .map((name) => fs.readFileSync(path.join(ROOT, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /new\s+Function\s*\(/);
});
