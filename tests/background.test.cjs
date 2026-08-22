"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const BACKGROUND_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "background.js"),
  "utf8"
);

const STORAGE_KEY = "jiraTogglSettings";
const WORKLOG_STATE_KEY = "jiraTogglWorklogState";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const JIRA_ORIGIN = "https://team-example.atlassian.net";
const JIRA_MATCH = `${JIRA_ORIGIN}/*`;
const ISSUE = {
  key: "PROJ-123",
  summary: "Improve the onboarding workflow",
  url: `${JIRA_ORIGIN}/browse/PROJ-123`,
  projectKey: "PROJ",
  projectName: "Example Project",
  issueNumber: "123",
  issueType: "Story",
  status: "In Progress",
  assignee: "Alex Developer",
  reporter: "Morgan Product",
  priority: "High",
  parentKey: "PROJ-100",
  labels: "cleanup, ai",
  components: "Prompts, Web"
};

function jsonResponse(payload, status = 200) {
  return new Response(payload === undefined ? "" : JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createHarness({
  initialSettings = null,
  initialWorklogState = null,
  permissions = []
} = {}) {
  const storage = {};
  if (initialSettings) {
    storage[STORAGE_KEY] = structuredClone(initialSettings);
  }
  if (initialWorklogState) {
    storage[WORKLOG_STATE_KEY] = structuredClone(initialWorklogState);
  }
  const permissionOrigins = new Set(permissions);
  const registeredScripts = new Map();
  const fetchQueue = [];
  const requests = [];
  const actionIconUpdates = [];
  const sidePanelBehaviors = [];
  const runtimeMessages = [];
  const listeners = {};
  let optionsOpenCount = 0;
  let accessLevel = null;

  const chrome = {
    action: {
      async setIcon({ path: iconPath }) {
        actionIconUpdates.push(structuredClone(iconPath));
      }
    },
    sidePanel: {
      async setPanelBehavior(behavior) {
        sidePanelBehaviors.push(structuredClone(behavior));
      }
    },
    storage: {
      local: {
        async setAccessLevel(value) {
          accessLevel = structuredClone(value);
        },
        async get(key) {
          if (typeof key === "string") {
            return Object.prototype.hasOwnProperty.call(storage, key)
              ? { [key]: structuredClone(storage[key]) }
              : {};
          }
          return structuredClone(storage);
        },
        async set(value) {
          Object.assign(storage, structuredClone(value));
        },
        async remove(key) {
          for (const item of Array.isArray(key) ? key : [key]) {
            delete storage[item];
          }
        }
      }
    },
    runtime: {
      id: EXTENSION_ID,
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        }
      },
      onStartup: {
        addListener(listener) {
          listeners.startup = listener;
        }
      },
      onMessage: {
        addListener(listener) {
          listeners.message = listener;
        }
      },
      async sendMessage(message) {
        runtimeMessages.push(structuredClone(message));
      },
      async openOptionsPage() {
        optionsOpenCount += 1;
      }
    },
    permissions: {
      onAdded: {
        addListener(listener) {
          listeners.permissionAdded = listener;
        }
      },
      onRemoved: {
        addListener(listener) {
          listeners.permissionRemoved = listener;
        }
      },
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
        const scripts = [...registeredScripts.values()].map((value) => structuredClone(value));
        return ids?.length ? scripts.filter((script) => ids.includes(script.id)) : scripts;
      },
      async registerContentScripts(scripts) {
        for (const script of scripts) {
          registeredScripts.set(script.id, structuredClone(script));
        }
      },
      async updateContentScripts(scripts) {
        for (const script of scripts) {
          if (!registeredScripts.has(script.id)) {
            throw new Error(`Unknown content script: ${script.id}`);
          }
          registeredScripts.set(script.id, {
            ...registeredScripts.get(script.id),
            ...structuredClone(script)
          });
        }
      },
      async unregisterContentScripts({ ids } = {}) {
        if (!ids) {
          registeredScripts.clear();
          return;
        }
        for (const id of ids) {
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

  return {
    context,
    storage,
    permissionOrigins,
    registeredScripts,
    fetchQueue,
    requests,
    actionIconUpdates,
    sidePanelBehaviors,
    runtimeMessages,
    listeners,
    get optionsOpenCount() {
      return optionsOpenCount;
    },
    get accessLevel() {
      return accessLevel;
    },
    jiraSender(origin = JIRA_ORIGIN) {
      const url = `${origin}/browse/PROJ-123`;
      return {
        id: EXTENSION_ID,
        url,
        tab: { url }
      };
    },
    extensionSender(page = "sidepanel.html") {
      return {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/${page}`
      };
    }
  };
}

test("configures the toolbar action to toggle the side panel", async () => {
  const harness = createHarness();
  await Promise.resolve();

  assert.deepEqual(harness.sidePanelBehaviors, [
    { openPanelOnActionClick: true }
  ]);
});

function configuredSettings(overrides = {}) {
  return {
    apiToken: "test-token",
    jiraOrigin: JIRA_ORIGIN,
    workspaceId: 123,
    workspaceName: "Workspace QA",
    profileName: "Dev QA",
    projectId: 456,
    projectName: "Internal Engineering",
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

test("saves protected Toggl settings and synchronizes an existing running icon", async () => {
  const harness = createHarness({ permissions: [JIRA_MATCH] });
  harness.fetchQueue.push(
    jsonResponse({ default_workspace_id: 123, fullname: "Dev QA" }),
    jsonResponse({ id: 123, name: "Workspace QA" }),
    jsonResponse({ id: 456, workspace_id: 123, name: "Internal Engineering" }),
    jsonResponse({
      id: 8000,
      workspace_id: 123,
      description: "Already running",
      start: "2026-08-21T12:00:00Z",
      duration: -1
    })
  );

  const result = await harness.context.handleMessage(
    {
      type: "VALIDATE_AND_SAVE_SETTINGS",
      settings: {
        jiraOrigin: `${JIRA_ORIGIN}/jira/software/c/projects/ECP/boards/754/backlog`,
        apiToken: "test-token",
        workspaceId: "",
        projectId: "456",
        billable: true,
        descriptionTemplate: "[{key}] {summary}",
        stopExisting: true,
        syncWorklogs: true,
        worklogSyncMode: "manual",
        worklogRounding: "ceil-minute",
        worklogCommentTemplate: "{issueKey}: {description} ({togglId})"
      }
    },
    harness.extensionSender("options.html")
  );

  await Promise.resolve();

  assert.equal(harness.accessLevel?.accessLevel, "TRUSTED_CONTEXTS");
  assert.equal(result.configured, true);
  assert.equal(result.jiraOrigin, JIRA_ORIGIN);
  assert.equal(result.billable, true);
  assert.equal(result.workspaceId, 123);
  assert.equal(result.workspaceName, "Workspace QA");
  assert.equal(result.syncWorklogs, true);
  assert.equal(result.worklogSyncMode, "manual");
  assert.equal(result.worklogRounding, "ceil-minute");
  assert.equal(result.worklogCommentTemplate, "{issueKey}: {description} ({togglId})");
  assert.equal(Object.hasOwn(result, "apiToken"), false);
  assert.equal(harness.storage[STORAGE_KEY].apiToken, "test-token");
  assert.equal(harness.storage[STORAGE_KEY].billable, true);
  assert.equal(harness.storage[STORAGE_KEY].syncWorklogs, true);

  const script = [...harness.registeredScripts.values()][0];
  assert.deepEqual(script.matches, [JIRA_MATCH]);
  assert.deepEqual(script.js, ["content.js"]);
  assert.equal(script.persistAcrossSessions, true);

  assert.equal(harness.requests.length, 4);
  assert.equal(
    harness.requests[0].url,
    "https://api.track.toggl.com/api/v9/me?with_related_data=true"
  );
  assert.equal(
    harness.requests[0].headers.Authorization,
    `Basic ${btoa("test-token:api_token")}`
  );
  assert.match(harness.requests[3].url, /\/me\/time_entries\/current$/);
  assert.equal(harness.actionIconUpdates.at(-1)["16"], "icons/icon-running16.png");
});

test("starts a Jira timer with the default description and selected billing value", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({ billable: true }),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({
      id: 9001,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      billable: true,
      start: "2026-08-19T12:00:00Z",
      duration: -1
    })
  );

  const result = await harness.context.handleMessage(
    { type: "START_TIMER", issue: ISSUE },
    harness.jiraSender()
  );

  assert.equal(result.action, "started");
  assert.equal(result.description, "[PROJ-123] Improve the onboarding workflow");
  assert.equal(result.billable, true);
  assert.equal(result.entry.id, 9001);

  const body = JSON.parse(harness.requests[1].body);
  assert.equal(body.description, "[PROJ-123] Improve the onboarding workflow");
  assert.equal(body.billable, true);
  assert.equal(body.workspace_id, 123);
  assert.equal(body.project_id, 456);
  assert.equal(body.duration, -1);
  assert.equal(body.stop, null);
  assert.equal(body.created_with, "jira-toggl-quickstart-chrome");

  const tracked = harness.storage[WORKLOG_STATE_KEY].entries["9001"];
  assert.equal(tracked.issueKey, "PROJ-123");
  assert.equal(tracked.status, "running");
  assert.equal(tracked.description, "[PROJ-123] Improve the onboarding workflow");
  assert.deepEqual(harness.runtimeMessages, [{ type: "SIDE_PANEL_STATE_CHANGED" }]);
});

test("renders all supported Jira template variables", () => {
  const harness = createHarness();
  const template = [
    "{key}",
    "{summary}",
    "{url}",
    "{projectKey}",
    "{projectName}",
    "{issueNumber}",
    "{issueType}",
    "{status}",
    "{assignee}",
    "{reporter}",
    "{priority}",
    "{parentKey}",
    "{labels}",
    "{components}"
  ].join(" | ");

  const rendered = harness.context.formatDescription(template, ISSUE);
  assert.equal(
    rendered,
    [
      "PROJ-123",
      "Improve the onboarding workflow",
      `${JIRA_ORIGIN}/browse/PROJ-123`,
      "PROJ",
      "Example Project",
      "123",
      "Story",
      "In Progress",
      "Alex Developer",
      "Morgan Product",
      "High",
      "PROJ-100",
      "cleanup, ai",
      "Prompts, Web"
    ].join(" | ")
  );
});

test("starts a manual popup timer using the same project and non-billable default", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({
      projectId: 456,
      projectName: "Internal Engineering",
      billable: false
    }),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({
      id: 9100,
      workspace_id: 123,
      project_id: 456,
      description: "Team planning and notes",
      billable: false,
      start: "2026-08-19T13:00:00Z",
      duration: -1
    })
  );

  const result = await harness.context.handleMessage(
    { type: "START_MANUAL_TIMER", description: "  Team   planning and notes  " },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.action, "started");
  assert.equal(result.description, "Team planning and notes");
  assert.equal(result.entry.projectId, 456);

  const body = JSON.parse(harness.requests[1].body);
  assert.equal(body.description, "Team planning and notes");
  assert.equal(body.project_id, 456);
  assert.equal(body.billable, false);
  assert.equal(Object.hasOwn(harness.storage, WORKLOG_STATE_KEY), false);
});

test("stops an existing timer before starting a different manual timer", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({ billable: true }),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse({
      id: 8000,
      workspace_id: 123,
      description: "Previous work",
      billable: false,
      start: "2026-08-19T11:00:00Z",
      duration: -1
    }),
    jsonResponse({ id: 8000, workspace_id: 123, stop: "2026-08-19T12:00:00Z" }),
    jsonResponse({
      id: 9200,
      workspace_id: 123,
      description: "New work",
      billable: true,
      start: "2026-08-19T12:00:00Z",
      duration: -1
    })
  );

  const result = await harness.context.handleMessage(
    { type: "START_MANUAL_TIMER", description: "New work" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.stoppedPrevious, true);
  assert.equal(harness.requests[1].method, "PATCH");
  assert.equal(
    harness.requests[1].url,
    "https://api.track.toggl.com/api/v9/workspaces/123/time_entries/8000/stop"
  );
  assert.equal(harness.requests[2].method, "POST");
});

test("serializes concurrent timer mutations so only one Toggl timer survives", async () => {
  const harness = createHarness({ initialSettings: configuredSettings() });
  let current = null;
  let nextId = 9300;
  const respondFromTogglState = (url, options = {}) => {
    const method = options.method || "GET";
    if (String(url).endsWith("/me/time_entries/current")) {
      return jsonResponse(current);
    }
    if (method === "PATCH") {
      const stopped = { ...current, stop: new Date().toISOString(), duration: 1 };
      current = null;
      return jsonResponse(stopped);
    }
    if (method === "POST") {
      current = { id: nextId++, ...JSON.parse(options.body) };
      return jsonResponse(current);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  harness.fetchQueue.push(...Array(8).fill(respondFromTogglState));

  const [first, second] = await Promise.all([
    harness.context.handleMessage(
      { type: "START_MANUAL_TIMER", description: "First concurrent task" },
      harness.extensionSender("popup.html")
    ),
    harness.context.handleMessage(
      { type: "START_MANUAL_TIMER", description: "Second concurrent task" },
      harness.extensionSender("popup.html")
    )
  ]);

  assert.equal(first.action, "started");
  assert.equal(second.action, "started");
  assert.equal(second.stoppedPrevious, true);
  assert.equal(current.description, "Second concurrent task");
  assert.deepEqual(harness.requests.map((request) => request.method), [
    "GET", "POST", "GET", "PATCH", "POST"
  ]);
});

test("does not recreate timer state after settings are cleared", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  let releaseCurrentLookup;
  const blockedCurrentLookup = new Promise((resolve) => {
    releaseCurrentLookup = () => resolve(jsonResponse(null));
  });
  const manualEntry = {
    id: 9400,
    workspace_id: 123,
    description: "Blocking manual task",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  harness.fetchQueue.push(
    () => blockedCurrentLookup,
    jsonResponse(manualEntry),
    jsonResponse(manualEntry),
    jsonResponse({ ...manualEntry, stop: "2026-08-20T10:30:00Z", duration: 1800 }),
    jsonResponse({
      id: 9401,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-20T10:30:00Z",
      duration: -1
    })
  );

  const manualStart = harness.context.handleMessage(
    { type: "START_MANUAL_TIMER", description: "Blocking manual task" },
    harness.extensionSender("popup.html")
  );
  await new Promise((resolve) => setImmediate(resolve));
  const jiraStart = harness.context.handleMessage(
    { type: "START_TIMER", issue: ISSUE },
    harness.jiraSender()
  );
  await new Promise((resolve) => setImmediate(resolve));
  const clear = harness.context.handleMessage(
    { type: "CLEAR_SETTINGS" },
    harness.extensionSender("options.html")
  );
  await Promise.race([
    clear,
    new Promise((resolve) => setImmediate(resolve))
  ]);
  releaseCurrentLookup();
  await Promise.all([manualStart, jiraStart, clear]);

  assert.equal(harness.storage[STORAGE_KEY], undefined);
  assert.equal(harness.storage[WORKLOG_STATE_KEY], undefined);
});

test("notifies the side panel when switching stops the timer but restart fails", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse({
      id: 9500,
      workspace_id: 123,
      description: "Previous task",
      start: "2026-08-20T10:00:00Z",
      duration: -1
    }),
    jsonResponse({
      id: 9500,
      workspace_id: 123,
      description: "Previous task",
      start: "2026-08-20T10:00:00Z",
      stop: "2026-08-20T10:30:00Z",
      duration: 1800
    }),
    jsonResponse({ message: "Toggl create failed" }, 500)
  );

  await assert.rejects(
    harness.context.handleMessage(
      { type: "START_TIMER", issue: ISSUE },
      harness.jiraSender()
    )
  );

  assert.deepEqual(harness.requests.map((request) => request.method), [
    "GET", "PATCH", "POST"
  ]);
  assert.deepEqual(harness.runtimeMessages, [
    { type: "SIDE_PANEL_STATE_CHANGED" }
  ]);
});

test("refreshes the side panel after a failed manual timer switch", async () => {
  const harness = createHarness({ initialSettings: configuredSettings() });
  harness.fetchQueue.push(
    jsonResponse({
      id: 9501,
      workspace_id: 123,
      description: "Previous task",
      start: "2026-08-20T10:00:00Z",
      duration: -1
    }),
    jsonResponse({
      id: 9501,
      workspace_id: 123,
      description: "Previous task",
      start: "2026-08-20T10:00:00Z",
      stop: "2026-08-20T10:30:00Z",
      duration: 1800
    }),
    jsonResponse({ message: "Toggl create failed" }, 500)
  );

  await assert.rejects(
    harness.context.handleMessage(
      { type: "START_MANUAL_TIMER", description: "Replacement task" },
      harness.extensionSender("popup.html")
    )
  );

  assert.deepEqual(harness.runtimeMessages, [
    { type: "SIDE_PANEL_STATE_CHANGED" }
  ]);
});

test("rejects unknown description variables before calling Toggl", async () => {
  const harness = createHarness({ permissions: [JIRA_MATCH] });

  await assert.rejects(
    harness.context.handleMessage(
      {
        type: "VALIDATE_AND_SAVE_SETTINGS",
        settings: {
          jiraOrigin: JIRA_ORIGIN,
          apiToken: "test-token",
          projectId: "456",
          descriptionTemplate: "[{ticket}] {summary}",
          billable: false,
          stopExisting: true
        }
      },
      harness.extensionSender("options.html")
    ),
    (error) => error?.code === "UNKNOWN_TEMPLATE_VARIABLE"
  );

  assert.equal(harness.requests.length, 0);
});

test("manual timers can only be started by trusted extension pages", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });

  await assert.rejects(
    harness.context.handleMessage(
      { type: "START_MANUAL_TIMER", description: "Injected work" },
      harness.jiraSender()
    ),
    (error) => error?.code === "UNTRUSTED_SENDER"
  );

  assert.equal(harness.requests.length, 0);
});

test("blocks Jira messages from an origin other than the configured site", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });

  await assert.rejects(
    harness.context.handleMessage(
      { type: "START_TIMER", issue: ISSUE },
      harness.jiraSender("https://another-company.atlassian.net")
    ),
    (error) => error?.code === "UNTRUSTED_SENDER"
  );

  assert.equal(harness.requests.length, 0);
});

test("returns a Toggl-ready popup state even when Jira permission is not granted", async () => {
  const harness = createHarness({ initialSettings: configuredSettings() });
  harness.fetchQueue.push(jsonResponse(null), jsonResponse([]));

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.settings.togglConfigured, true);
  assert.equal(result.settings.jiraConfigured, false);
  assert.equal(result.settings.configured, false);
  assert.equal(result.current, null);
});

test("clearing settings unregisters the Jira script and removes the saved origin permission", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings(),
    initialWorklogState: {
      version: 1,
      entries: {
        "9001": { togglEntryId: 9001, status: "pending", jiraOrigin: JIRA_ORIGIN }
      }
    },
    permissions: [JIRA_MATCH]
  });
  harness.registeredScripts.set("jira-toggl-quick-start-content", {
    id: "jira-toggl-quick-start-content",
    matches: [JIRA_MATCH],
    js: ["content.js"]
  });

  const result = await harness.context.handleMessage(
    { type: "CLEAR_SETTINGS" },
    harness.extensionSender("options.html")
  );

  assert.equal(result.cleared, true);
  assert.equal(Object.hasOwn(harness.storage, STORAGE_KEY), false);
  assert.equal(Object.hasOwn(harness.storage, WORKLOG_STATE_KEY), false);
  assert.equal(harness.permissionOrigins.has(JIRA_MATCH), false);
  assert.equal(harness.registeredScripts.size, 0);
  assert.equal(harness.actionIconUpdates.at(-1)["16"], "icons/icon16.png");
});


test("creates a nearest-minute Jira Work Log and adjusts the remaining estimate", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({
      syncWorklogs: true,
      worklogSyncMode: "automatic",
      worklogRounding: "nearest-minute",
      worklogCommentTemplate: "Synced from Toggl: {description} ({togglId})"
    }),
    permissions: [JIRA_MATCH]
  });

  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({
      id: 9300,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      billable: false,
      start: "2026-08-19T10:00:00Z",
      duration: -1
    })
  );

  await harness.context.handleMessage(
    { type: "START_TIMER", issue: ISSUE },
    harness.jiraSender()
  );

  harness.fetchQueue.push(
    jsonResponse({
      id: 9300,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      billable: false,
      start: "2026-08-19T10:00:00Z",
      duration: -1
    }),
    jsonResponse({
      id: 9300,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-19T10:00:00Z",
      stop: "2026-08-19T10:42:05Z",
      duration: 2525
    }),
    jsonResponse({ startAt: 0, maxResults: 1000, total: 0, worklogs: [] }),
    jsonResponse({ id: "70001", timeSpentSeconds: 2520 })
  );

  const result = await harness.context.handleMessage(
    { type: "STOP_TIMER", issue: ISSUE },
    harness.jiraSender()
  );

  assert.equal(result.action, "stopped");
  assert.equal(result.worklogSync.status, "synced");
  assert.equal(result.worklogSync.issueKey, "PROJ-123");
  assert.equal(result.worklogSync.worklogId, "70001");
  assert.equal(result.worklogSync.durationSeconds, 2525);

  const jiraGet = harness.requests.find((request) =>
    request.method === "GET" && request.url.includes("/worklog?")
  );
  const jiraPost = harness.requests.find((request) =>
    request.method === "POST" && request.url.includes("/worklog?")
  );

  assert.ok(jiraGet, "expected duplicate-prevention Work Log lookup");
  assert.ok(jiraPost, "expected Jira Work Log creation request");
  assert.match(jiraPost.url, /\/rest\/api\/3\/issue\/PROJ-123\/worklog\?/);
  assert.match(jiraPost.url, /adjustEstimate=auto/);
  assert.match(jiraPost.url, /notifyUsers=false/);
  assert.equal(jiraPost.credentials, "include");
  assert.equal(jiraPost.cache, "no-store");

  const body = JSON.parse(jiraPost.body);
  assert.equal(body.timeSpentSeconds, 2520);
  assert.equal(body.started, "2026-08-19T10:00:00.000+0000");
  assert.equal(body.comment.type, "doc");
  assert.equal(
    body.comment.content[0].content[0].text,
    "Synced from Toggl: [PROJ-123] Improve the onboarding workflow (9300)"
  );
  assert.equal(body.properties[0].key, "jira-toggl-quickstart");
  assert.equal(body.properties[0].value.togglTimeEntryId, 9300);
  assert.equal(body.properties[0].value.togglWorkspaceId, 123);

  const tracked = harness.storage[WORKLOG_STATE_KEY].entries["9300"];
  assert.equal(tracked.status, "synced");
  assert.equal(tracked.worklogId, "70001");
  assert.equal(tracked.lastError, "");
});

test("queues manual Work Log confirmation and syncs it from the popup", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({
      syncWorklogs: true,
      worklogSyncMode: "manual"
    }),
    permissions: [JIRA_MATCH]
  });

  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({
      id: 9400,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-19T11:00:00Z",
      duration: -1
    })
  );
  await harness.context.handleMessage(
    { type: "START_TIMER", issue: ISSUE },
    harness.jiraSender()
  );

  harness.fetchQueue.push(
    jsonResponse({
      id: 9400,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-19T11:00:00Z",
      duration: -1
    }),
    jsonResponse({
      id: 9400,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-19T11:00:00Z",
      stop: "2026-08-19T11:15:30Z",
      duration: 930
    })
  );

  const stopped = await harness.context.handleMessage(
    { type: "STOP_TIMER", issue: ISSUE },
    harness.jiraSender()
  );

  assert.equal(stopped.worklogSync.status, "queued");
  assert.equal(stopped.worklogSync.reason, "confirmation");
  assert.equal(harness.requests.filter((request) => request.url.includes("/worklog")).length, 0);

  harness.fetchQueue.push(
    jsonResponse({ startAt: 0, maxResults: 1000, total: 0, worklogs: [] }),
    jsonResponse({ id: "70002" })
  );
  const synced = await harness.context.handleMessage(
    { type: "SYNC_PENDING_WORKLOGS" },
    harness.extensionSender("popup.html")
  );

  assert.equal(synced.synced, 1);
  assert.equal(synced.failed, 0);
  assert.equal(synced.worklogs.pendingCount, 0);
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["9400"].status, "synced");
});

test("keeps a failed Jira Work Log in the local retry queue", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({
      syncWorklogs: true,
      worklogSyncMode: "automatic"
    }),
    initialWorklogState: {
      version: 1,
      entries: {
        "9500": {
          togglEntryId: 9500,
          workspaceId: 123,
          jiraOrigin: JIRA_ORIGIN,
          issueKey: "PROJ-123",
          description: "[PROJ-123] Improve the onboarding workflow",
          started: "2026-08-19T12:00:00Z",
          stopped: "2026-08-19T12:10:00Z",
          durationSeconds: 600,
          status: "pending",
          worklogId: null,
          lastError: "",
          createdAt: "2026-08-19T12:00:00Z",
          updatedAt: "2026-08-19T12:10:00Z"
        }
      }
    },
    permissions: [JIRA_MATCH]
  });

  harness.fetchQueue.push(jsonResponse({ errorMessages: ["Work on issues permission required"] }, 403));
  const result = await harness.context.handleMessage(
    { type: "SYNC_PENDING_WORKLOGS" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.synced, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.worklogs.pendingCount, 1);
  const pending = harness.storage[WORKLOG_STATE_KEY].entries["9500"];
  assert.equal(pending.status, "pending");
  assert.match(pending.lastError, /Browse projects and Work on issues/);
});

test("detects an existing Jira Work Log by Toggl entry property and avoids duplicates", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({
      syncWorklogs: true,
      worklogSyncMode: "automatic"
    }),
    initialWorklogState: {
      version: 1,
      entries: {
        "9600": {
          togglEntryId: 9600,
          workspaceId: 123,
          jiraOrigin: JIRA_ORIGIN,
          issueKey: "PROJ-123",
          description: "[PROJ-123] Improve the onboarding workflow",
          started: "2026-08-19T13:00:00Z",
          stopped: "2026-08-19T13:20:00Z",
          durationSeconds: 1200,
          status: "pending",
          worklogId: null,
          lastError: "",
          createdAt: "2026-08-19T13:00:00Z",
          updatedAt: "2026-08-19T13:20:00Z"
        }
      }
    },
    permissions: [JIRA_MATCH]
  });

  harness.fetchQueue.push(jsonResponse({
    startAt: 0,
    maxResults: 1000,
    total: 1,
    worklogs: [
      {
        id: "70003",
        properties: [
          {
            key: "jira-toggl-quickstart",
            value: { togglTimeEntryId: 9600 }
          }
        ]
      }
    ]
  }));

  const result = await harness.context.handleMessage(
    { type: "SYNC_PENDING_WORKLOGS" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.synced, 1);
  assert.equal(result.results[0].existing, true);
  assert.equal(result.results[0].worklogId, "70003");
  assert.equal(harness.requests.filter((request) => request.method === "POST").length, 0);
});

test("reconciles a Jira timer stopped outside the extension when the popup opens", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({
      syncWorklogs: true,
      worklogSyncMode: "automatic"
    }),
    initialWorklogState: {
      version: 1,
      entries: {
        "9700": {
          togglEntryId: 9700,
          workspaceId: 123,
          jiraOrigin: JIRA_ORIGIN,
          issueKey: "PROJ-123",
          description: "[PROJ-123] Improve the onboarding workflow",
          started: "2026-08-19T14:00:00Z",
          stopped: null,
          durationSeconds: null,
          status: "running",
          worklogId: null,
          lastError: "",
          createdAt: "2026-08-19T14:00:00Z",
          updatedAt: "2026-08-19T14:00:00Z"
        }
      }
    },
    permissions: [JIRA_MATCH]
  });

  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({
      id: 9700,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-19T14:00:00Z",
      stop: "2026-08-19T14:25:00Z",
      duration: 1500
    }),
    jsonResponse({ startAt: 0, maxResults: 1000, total: 0, worklogs: [] }),
    jsonResponse({ id: "70004" }),
    jsonResponse([])
  );

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.current, null);
  assert.equal(result.worklogs.pendingCount, 0);
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["9700"].status, "synced");
  assert.ok(
    harness.requests.some((request) =>
      request.url === "https://api.track.toggl.com/api/v9/me/time_entries/9700"
    )
  );
});

test("returns only validated Jira UI settings to the configured Jira origin", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({ floatingButtonPosition: "top-left" })
  });

  const result = await harness.context.handleMessage(
    { type: "GET_JIRA_UI_SETTINGS" },
    harness.jiraSender()
  );
  assert.deepEqual({ ...result }, { floatingButtonPosition: "top-left" });

  await assert.rejects(
    harness.context.handleMessage(
      { type: "GET_JIRA_UI_SETTINGS" },
      harness.jiraSender("https://attacker.example")
    ),
    /authorized Jira site/i
  );
});

test("applies the supported Jira Work Log rounding modes", () => {
  const harness = createHarness();
  assert.equal(harness.context.applyWorklogRounding(89, "exact"), 60);
  assert.equal(harness.context.applyWorklogRounding(89, "nearest-minute"), 60);
  assert.equal(harness.context.applyWorklogRounding(91, "nearest-minute"), 120);
  assert.equal(harness.context.applyWorklogRounding(61, "ceil-minute"), 120);
});

test("calculates stopped duration from timestamps when Toggl omits duration", () => {
  const harness = createHarness();
  assert.equal(
    harness.context.calculateTimeEntryDuration({
      start: "2026-08-19T15:00:00Z",
      stop: "2026-08-19T15:03:21Z",
      duration: null
    }),
    201
  );
});

test("synchronizes the previous Jira timer before automatic switching", async () => {
  const secondIssue = {
    ...ISSUE,
    key: "PROJ-124",
    issueNumber: "124",
    summary: "Ship the next onboarding step",
    url: `${JIRA_ORIGIN}/browse/PROJ-124`
  };
  const harness = createHarness({
    initialSettings: configuredSettings({
      syncWorklogs: true,
      worklogSyncMode: "automatic"
    }),
    permissions: [JIRA_MATCH]
  });

  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({
      id: 9800,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-19T16:00:00Z",
      duration: -1
    })
  );
  await harness.context.handleMessage(
    { type: "START_TIMER", issue: ISSUE },
    harness.jiraSender()
  );

  harness.fetchQueue.push(
    jsonResponse({
      id: 9800,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-19T16:00:00Z",
      duration: -1
    }),
    jsonResponse({
      id: 9800,
      workspace_id: 123,
      description: "[PROJ-123] Improve the onboarding workflow",
      start: "2026-08-19T16:00:00Z",
      stop: "2026-08-19T16:12:00Z",
      duration: 720
    }),
    jsonResponse({ startAt: 0, maxResults: 1000, total: 0, worklogs: [] }),
    jsonResponse({ id: "70005" }),
    jsonResponse({
      id: 9801,
      workspace_id: 123,
      description: "[PROJ-124] Ship the next onboarding step",
      start: "2026-08-19T16:12:00Z",
      duration: -1
    })
  );

  const result = await harness.context.handleMessage(
    { type: "START_TIMER", issue: secondIssue },
    harness.jiraSender()
  );

  assert.equal(result.action, "started");
  assert.equal(result.stoppedPrevious, true);
  assert.equal(result.previousWorklogSync.status, "synced");
  assert.equal(result.previousWorklogSync.issueKey, "PROJ-123");
  assert.equal(result.entry.id, 9801);
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["9800"].status, "synced");
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["9801"].status, "running");
});

test("falls back from Jira REST v3 to v2 for compatible Work Log deployments", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({
      syncWorklogs: true,
      worklogSyncMode: "automatic"
    }),
    initialWorklogState: {
      version: 1,
      entries: {
        "9900": {
          togglEntryId: 9900,
          workspaceId: 123,
          jiraOrigin: JIRA_ORIGIN,
          issueKey: "PROJ-123",
          description: "[PROJ-123] Improve the onboarding workflow",
          started: "2026-08-19T17:00:00Z",
          stopped: "2026-08-19T17:05:00Z",
          durationSeconds: 300,
          status: "pending",
          worklogId: null,
          lastError: "",
          createdAt: "2026-08-19T17:00:00Z",
          updatedAt: "2026-08-19T17:05:00Z"
        }
      }
    },
    permissions: [JIRA_MATCH]
  });

  harness.fetchQueue.push(
    jsonResponse({ errorMessages: ["v3 unavailable"] }, 404),
    jsonResponse({ startAt: 0, maxResults: 1000, total: 0, worklogs: [] }),
    jsonResponse({ errorMessages: ["v3 unavailable"] }, 404),
    jsonResponse({ id: "70006" })
  );

  const result = await harness.context.handleMessage(
    { type: "SYNC_PENDING_WORKLOGS" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.synced, 1);
  const jiraRequests = harness.requests.filter((request) => request.url.includes("/worklog"));
  assert.match(jiraRequests[0].url, /\/rest\/api\/3\//);
  assert.match(jiraRequests[1].url, /\/rest\/api\/2\//);
  assert.match(jiraRequests[2].url, /\/rest\/api\/3\//);
  assert.match(jiraRequests[3].url, /\/rest\/api\/2\//);
  const body = JSON.parse(jiraRequests[3].body);
  assert.equal(typeof body.comment, "string");
});

test("rejects unknown Jira Work Log comment variables before calling either API", async () => {
  const harness = createHarness({ permissions: [JIRA_MATCH] });

  await assert.rejects(
    harness.context.handleMessage(
      {
        type: "VALIDATE_AND_SAVE_SETTINGS",
        settings: {
          jiraOrigin: JIRA_ORIGIN,
          apiToken: "test-token",
          projectId: "456",
          descriptionTemplate: "[{key}] {summary}",
          billable: false,
          stopExisting: true,
          syncWorklogs: true,
          worklogSyncMode: "automatic",
          worklogRounding: "nearest-minute",
          worklogCommentTemplate: "Synced from {unknownValue}"
        }
      },
      harness.extensionSender("options.html")
    ),
    (error) => error?.code === "UNKNOWN_WORKLOG_COMMENT_VARIABLE"
  );

  assert.equal(harness.requests.length, 0);
});

test("automatically selects the most-used active project when Project ID is blank", async () => {
  const harness = createHarness({ permissions: [JIRA_MATCH] });
  harness.fetchQueue.push(
    jsonResponse({
      default_workspace_id: 123,
      fullname: "Dev QA",
      projects: [
        { id: 456, workspace_id: 123, name: "Most used", active: true, actual_hours: 24 },
        { id: 457, workspace_id: 123, name: "Less used", active: true, actual_hours: 8 },
        { id: 458, workspace_id: 123, name: "Archived", active: false, actual_hours: 40 }
      ]
    }),
    jsonResponse({ id: 123, name: "Workspace QA" }),
    jsonResponse(null)
  );

  const result = await harness.context.handleMessage(
    {
      type: "VALIDATE_AND_SAVE_SETTINGS",
      settings: {
        jiraOrigin: JIRA_ORIGIN,
        apiToken: "test-token",
        projectId: "",
        descriptionTemplate: "[{key}] {summary}"
      }
    },
    harness.extensionSender("options.html")
  );

  assert.equal(result.configured, true);
  assert.equal(result.projectId, 456);
  assert.equal(result.projectName, "Most used");
  assert.equal(harness.requests.length, 3);
  assert.match(harness.requests[2].url, /\/me\/time_entries\/current$/);
});

test("rejects a Toggl project that belongs to a different workspace", async () => {
  const harness = createHarness({ permissions: [JIRA_MATCH] });
  harness.fetchQueue.push(
    jsonResponse({ default_workspace_id: 123, fullname: "Dev QA" }),
    jsonResponse({ id: 123, name: "Workspace QA" }),
    jsonResponse({ id: 456, workspace_id: 999, name: "Wrong workspace" })
  );

  await assert.rejects(
    harness.context.handleMessage(
      {
        type: "VALIDATE_AND_SAVE_SETTINGS",
        settings: {
          jiraOrigin: JIRA_ORIGIN,
          apiToken: "test-token",
          projectId: "456",
          descriptionTemplate: "[{key}] {summary}"
        }
      },
      harness.extensionSender("options.html")
    ),
    (error) => error?.code === "TOGGL_PROJECT_WORKSPACE_MISMATCH"
  );

  assert.equal(harness.requests.length, 3);
  assert.match(harness.requests[2].url, /\/workspaces\/123\/projects\/456$/);
});

test("rejects a Toggl project ID that does not exist", async () => {
  const harness = createHarness({ permissions: [JIRA_MATCH] });
  harness.fetchQueue.push(
    jsonResponse({ default_workspace_id: 123, fullname: "Dev QA" }),
    jsonResponse({ id: 123, name: "Workspace QA" }),
    jsonResponse({ message: "Project not found" }, 404)
  );

  await assert.rejects(
    harness.context.handleMessage(
      {
        type: "VALIDATE_AND_SAVE_SETTINGS",
        settings: {
          jiraOrigin: JIRA_ORIGIN,
          apiToken: "test-token",
          projectId: "456",
          descriptionTemplate: "[{key}] {summary}"
        }
      },
      harness.extensionSender("options.html")
    ),
    (error) => error?.code === "TOGGL_NOT_FOUND"
  );
});

test("does not force Settings open after an upgrade when Project ID is missing", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({ projectId: null, projectName: "" }),
    permissions: [JIRA_MATCH]
  });

  harness.listeners.installed({ reason: "update" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.optionsOpenCount, 0);
});

test("allows new projectless timers after an upgrade when Project ID is missing", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({ projectId: null, projectName: "" }),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse(null),
    jsonResponse({
      id: 11000,
      workspace_id: 123,
      description: "Projectless work",
      start: "2026-08-20T09:00:00Z",
      duration: -1
    })
  );

  const result = await harness.context.handleMessage(
    { type: "START_MANUAL_TIMER", description: "Projectless work" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.action, "started");
  const body = JSON.parse(harness.requests[1].body);
  assert.equal(Object.hasOwn(body, "project_id"), false);
});

test("keeps a projectless profile fully usable for reading and stopping timers", async () => {
  const running = {
    id: 11001,
    workspace_id: 123,
    description: "Existing running timer",
    billable: false,
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings({ projectId: null, projectName: "" }),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(jsonResponse(running), jsonResponse([]));

  const popup = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(popup.settings.togglConfigured, true);
  assert.equal(popup.settings.configurationRequired, "");
  assert.equal(popup.current.id, 11001);
  assert.equal(popup.workedToday.status, "ok");

  harness.fetchQueue.push(
    jsonResponse(running),
    jsonResponse({
      ...running,
      stop: "2026-08-20T10:30:00Z",
      duration: 1800
    })
  );
  const stopped = await harness.context.handleMessage(
    { type: "STOP_CURRENT_TIMER" },
    harness.extensionSender("popup.html")
  );

  assert.equal(stopped.action, "stopped");
  assert.equal(harness.requests.at(-1).method, "PATCH");
  assert.match(harness.requests.at(-1).url, /\/workspaces\/123\/time_entries\/11001\/stop$/);
});

test("calculates Worked today from completed entries only", () => {
  const harness = createHarness();
  const start = Date.parse("2026-08-20T00:00:00Z");
  const now = Date.parse("2026-08-20T12:00:00Z");
  const total = harness.context.calculateDailyWorkedSeconds([
    {
      id: 1,
      start: "2026-08-20T08:00:00Z",
      stop: "2026-08-20T09:15:00Z",
      duration: 4500
    },
    {
      id: 2,
      start: "2026-08-20T10:00:00Z",
      duration: 1800
    }
  ], null, start, now);

  assert.equal(total, 6300);
});

test("calculates Worked today with a running entry using Toggl duration semantics", () => {
  const harness = createHarness();
  const start = Date.parse("2026-08-20T00:00:00Z");
  const now = Date.parse("2026-08-20T12:00:00Z");
  const runningStart = Date.parse("2026-08-20T11:30:00Z");
  const running = {
    id: 3,
    start: "2026-08-20T11:30:00Z",
    duration: -Math.floor(runningStart / 1000)
  };
  const total = harness.context.calculateDailyWorkedSeconds([
    {
      id: 1,
      start: "2026-08-20T08:00:00Z",
      stop: "2026-08-20T09:00:00Z",
      duration: 3600
    },
    running
  ], running, start, now);

  assert.equal(total, 5400);
});

test("derives a running entry start from Toggl's negative duration when start is absent", () => {
  const harness = createHarness();
  const dayStart = Date.parse("2026-08-20T00:00:00Z");
  const now = Date.parse("2026-08-20T12:00:00Z");
  const runningStart = Date.parse("2026-08-20T11:42:30Z");

  assert.equal(
    harness.context.calculateDailyWorkedSeconds([
      {
        id: 4,
        duration: -Math.floor(runningStart / 1000)
      }
    ], null, dayStart, now),
    1050
  );
});

test("does not treat Toggl's preferred -1 running duration as a Unix start time", () => {
  const harness = createHarness();
  const dayStart = Date.parse("2026-08-20T00:00:00Z");
  const now = Date.parse("2026-08-20T12:00:00Z");

  assert.equal(
    harness.context.calculateDailyWorkedSeconds([
      { id: 5, duration: -1 }
    ], null, dayStart, now),
    0
  );
});

test("uses the browser-local midnight boundary and clips crossing entries", () => {
  const harness = createHarness();
  const interval = vm.runInContext(`(() => {
    const value = getLocalDayInterval(new Date(2026, 7, 20, 12, 34, 56));
    const localStart = new Date(value.start);
    return {
      ...value,
      localHour: localStart.getHours(),
      localMinute: localStart.getMinutes(),
      localDate: localStart.getDate()
    };
  })()`, harness.context);

  assert.equal(interval.localHour, 0);
  assert.equal(interval.localMinute, 0);
  assert.equal(interval.localDate, 20);

  const total = harness.context.calculateDailyWorkedSeconds([
    {
      id: 1,
      start: new Date(interval.startMs - 1800_000).toISOString(),
      stop: new Date(interval.startMs + 1800_000).toISOString(),
      duration: 3600
    }
  ], null, interval.startMs, interval.endMs);
  assert.equal(total, 1800);
});

test("returns zero Worked today when there are no entries", () => {
  const harness = createHarness();
  assert.equal(
    harness.context.calculateDailyWorkedSeconds([], null, 0, 10_000),
    0
  );
});

test("does not double-count the current entry returned by the daily endpoint", () => {
  const harness = createHarness();
  const start = Date.parse("2026-08-20T00:00:00Z");
  const now = Date.parse("2026-08-20T12:00:00Z");
  const current = {
    id: 44,
    start: "2026-08-20T11:00:00Z",
    duration: -1
  };

  assert.equal(
    harness.context.calculateDailyWorkedSeconds([current], current, start, now),
    3600
  );
});

test("includes daily entries from multiple projects and workspaces", () => {
  const harness = createHarness();
  const start = Date.parse("2026-08-20T00:00:00Z");
  const now = Date.parse("2026-08-20T12:00:00Z");
  const entries = [
    { id: 1, workspace_id: 123, project_id: 456, start: "2026-08-20T08:00:00Z", duration: 900 },
    { id: 2, workspace_id: 999, project_id: 777, start: "2026-08-20T09:00:00Z", duration: 1200 },
    { id: 3, workspace_id: 123, project_id: null, start: "2026-08-20T10:00:00Z", duration: 300 }
  ];

  assert.equal(
    harness.context.calculateDailyWorkedSeconds(entries, null, start, now),
    2400
  );
});

test("queries a one-day lookback once and clips daily and Monday-week totals", async () => {
  const harness = createHarness();
  const now = new Date(2026, 7, 20, 12, 0, 0);
  const crossingStart = new Date(2026, 7, 16, 23, 30, 0);
  const crossingStop = new Date(2026, 7, 17, 0, 30, 0);
  const mondayStart = new Date(2026, 7, 17, 9, 0, 0);
  const mondayStop = new Date(2026, 7, 17, 10, 0, 0);
  const todayStart = new Date(2026, 7, 20, 11, 30, 0);

  harness.fetchQueue.push(jsonResponse([
    {
      id: 0,
      start: crossingStart.toISOString(),
      stop: crossingStop.toISOString(),
      duration: 3600
    },
    {
      id: 1,
      start: mondayStart.toISOString(),
      stop: mondayStop.toISOString(),
      duration: 3600
    },
    {
      id: 2,
      start: todayStart.toISOString(),
      stop: now.toISOString(),
      duration: 1800
    }
  ]));

  const summary = await harness.context.getWorkedTodaySummary(
    "test-token",
    null,
    now
  );

  assert.equal(summary.status, "ok");
  assert.equal(summary.totalSeconds, 1800);
  assert.equal(summary.weekTotalSeconds, 7200);
  assert.equal(harness.requests.length, 1);

  const expectedWeekStart = new Date(2026, 7, 17).toISOString();
  const expectedQueryStart = new Date(2026, 7, 16).toISOString();
  const requestUrl = new URL(harness.requests[0].url);
  const requestedStart = new Date(requestUrl.searchParams.get("start_date"));
  assert.equal(summary.weekStart, expectedWeekStart);
  assert.equal(requestedStart.toISOString(), expectedQueryStart);
  assert.equal(requestedStart.getDay(), 0);
  assert.equal(requestedStart.getHours(), 0);
  assert.equal(requestedStart.getMinutes(), 0);
  assert.equal(requestUrl.searchParams.get("end_date"), now.toISOString());

  const sunday = harness.context.getLocalDayInterval(new Date(2026, 7, 23, 12));
  const nextMonday = harness.context.getLocalDayInterval(new Date(2026, 7, 24, 12));
  assert.equal(sunday.weekStart, expectedWeekStart);
  assert.equal(nextMonday.weekStart, new Date(2026, 7, 24).toISOString());
});

test("keeps Toggl totals available when local Jira associations cannot be read", async () => {
  const harness = createHarness();
  const now = new Date(2026, 7, 20, 12, 0, 0);
  const originalGet = harness.context.chrome.storage.local.get;
  harness.context.chrome.storage.local.get = async (key) => {
    if (key === WORKLOG_STATE_KEY) {
      throw new Error("Local association state unavailable");
    }
    return originalGet(key);
  };
  harness.fetchQueue.push(jsonResponse([{
    id: 1,
    description: "Available Toggl work",
    start: new Date(2026, 7, 20, 11, 0, 0).toISOString(),
    stop: now.toISOString(),
    duration: 3600
  }]));

  const summary = await harness.context.getWorkedTodaySummary(
    "test-token",
    null,
    now,
    configuredSettings()
  );

  assert.equal(summary.status, "ok");
  assert.equal(summary.totalSeconds, 3600);
  assert.equal(summary.appointments[0].description, "Available Toggl work");
  assert.equal(summary.appointments[0].issueKey, null);
});

test("groups today's Jira and manual appointments from the existing history response", () => {
  const harness = createHarness();
  const now = new Date(2026, 7, 20, 12, 0, 0);
  const interval = harness.context.getLocalDayInterval(now);
  const at = (day, hour, minute = 0) =>
    new Date(2026, 7, day, hour, minute, 0).toISOString();
  const running = {
    id: 106,
    description: "Customer onboarding",
    start: at(20, 11, 30),
    duration: -1
  };
  const entries = [
    { id: 100, description: "Old title", start: at(20, 8), stop: at(20, 9), duration: 3600 },
    { id: 101, description: "Customer onboarding", start: at(20, 10), stop: at(20, 10, 30), duration: 1800 },
    { id: 102, description: " Review docs ", start: at(20, 9), duration: 1200 },
    { id: 103, description: "Review   docs", start: at(20, 11), duration: 600 },
    { id: 104, description: "[OPS-9] Manually typed", start: at(20, 7), duration: 900 },
    { id: 105, description: "Crossing midnight", start: at(19, 23, 30), stop: at(20, 0, 30), duration: 3600 },
    running
  ];
  const state = {
    entries: Object.fromEntries([100, 101, 105, 106].map((id) => [String(id), {
      togglEntryId: id,
      jiraOrigin: JIRA_ORIGIN,
      issueKey: id === 105 ? "PROJ-9" : "PROJ-123"
    }]))
  };

  const summary = harness.context.buildWorkedSummary(
    entries,
    running,
    interval,
    state,
    configuredSettings()
  );

  assert.equal(summary.totalSeconds, 11700);
  assert.deepEqual(
    Array.from(summary.appointments, (item) => item.issueKey),
    ["PROJ-123", null, null, "PROJ-9"]
  );
  assert.deepEqual(
    Array.from(summary.appointments, (item) => item.description),
    ["Customer onboarding", "Review docs", "[OPS-9] Manually typed", "Crossing midnight"]
  );
  assert.deepEqual(
    Array.from(summary.appointments, (item) => item.totalSeconds),
    [7200, 1800, 900, 1800]
  );
  assert.equal(summary.appointments[0].sourceEntryId, 106);
  assert.equal(summary.appointments[0].runningEntryId, 106);
  assert.equal(summary.appointments[1].sourceEntryId, 103);
  assert.equal(summary.appointments[2].issueKey, null, "description keys must not create Jira provenance");
});

test("retains capped Jira provenance when Work Log sync is disabled", async () => {
  const harness = createHarness({
    initialWorklogState: {
      version: 1,
      entries: {
        "7001": {
          togglEntryId: 7001,
          workspaceId: 123,
          jiraOrigin: JIRA_ORIGIN,
          issueKey: "PROJ-123",
          description: "Custom description without a key",
          started: "2026-08-20T10:00:00Z",
          status: "running",
          createdAt: "2026-08-20T10:00:00Z",
          updatedAt: "2026-08-20T10:00:00Z"
        }
      }
    }
  });

  const result = await harness.context.finalizeTrackedTimer({
    id: 7001,
    workspace_id: 123,
    description: "Custom description without a key",
    start: "2026-08-20T10:00:00Z",
    stop: "2026-08-20T10:30:00Z",
    duration: 1800
  }, configuredSettings({ syncWorklogs: false }));

  assert.equal(result.status, "disabled");
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["7001"].status, "completed");
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["7001"].issueKey, "PROJ-123");
});

test("caps terminal Jira provenance while retaining active Work Log records", async () => {
  const harness = createHarness();
  const entries = Object.fromEntries(Array.from({ length: 205 }, (_, index) => {
    const togglEntryId = 8000 + index;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    return [String(togglEntryId), {
      togglEntryId,
      status: "completed",
      updatedAt
    }];
  }));
  entries["9001"] = {
    togglEntryId: 9001,
    status: "running",
    updatedAt: "2025-01-01T00:00:00.000Z"
  };
  entries["9002"] = {
    togglEntryId: 9002,
    status: "pending",
    updatedAt: "2025-01-01T00:00:00.000Z"
  };

  await harness.context.saveWorklogState({ entries });

  const saved = harness.storage[WORKLOG_STATE_KEY].entries;
  assert.equal(Object.keys(saved).length, 200);
  assert.ok(saved["9001"]);
  assert.ok(saved["9002"]);
  assert.equal(saved["8000"], undefined);
  assert.ok(saved["8007"]);
  assert.ok(saved["8204"]);
});

test("replays a today's appointment by stopping the current timer even when switching is disabled", async () => {
  const now = Date.now();
  const source = {
    id: 7101,
    workspace_id: 123,
    description: "Review pull request",
    start: new Date(now - 3_600_000).toISOString(),
    stop: new Date(now - 1_800_000).toISOString(),
    duration: 1800
  };
  const current = {
    id: 7102,
    workspace_id: 123,
    description: "Current task",
    start: new Date(now - 900_000).toISOString(),
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings({ stopExisting: false })
  });
  harness.fetchQueue.push(
    jsonResponse(source),
    jsonResponse(current),
    jsonResponse({ ...current, stop: new Date().toISOString(), duration: 900 }),
    jsonResponse({ id: 7103, workspace_id: 123, description: source.description, duration: -1 })
  );

  const result = await harness.context.handleMessage(
    { type: "START_TODAY_APPOINTMENT", sourceEntryId: source.id },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.action, "started");
  assert.equal(result.stoppedPrevious, true);
  assert.deepEqual(harness.requests.map((request) => request.method), ["GET", "GET", "PATCH", "POST"]);
  assert.match(harness.requests[0].url, /\/me\/time_entries\/7101$/);
  assert.match(harness.requests[2].url, /\/time_entries\/7102\/stop$/);
  assert.equal(JSON.parse(harness.requests[3].body).description, source.description);
});

test("replay still logs and replaces a different Jira timer with the same description", async () => {
  const now = Date.now();
  const source = {
    id: 7151,
    workspace_id: 123,
    description: "Shared timer description",
    start: new Date(now - 3_600_000).toISOString(),
    stop: new Date(now - 1_800_000).toISOString(),
    duration: 1800
  };
  const current = {
    id: 7152,
    workspace_id: 123,
    description: source.description,
    start: new Date(now - 600_000).toISOString(),
    duration: -1
  };
  const worklogState = {
    version: 1,
    entries: {
      "7151": {
        togglEntryId: 7151,
        workspaceId: 123,
        jiraOrigin: JIRA_ORIGIN,
        issueKey: "PROJ-123",
        description: source.description,
        status: "completed",
        updatedAt: source.stop
      },
      "7152": {
        togglEntryId: 7152,
        workspaceId: 123,
        jiraOrigin: JIRA_ORIGIN,
        issueKey: "OTHER-7",
        description: current.description,
        started: current.start,
        status: "running",
        updatedAt: current.start
      }
    }
  };
  const harness = createHarness({
    initialSettings: configuredSettings({ syncWorklogs: true }),
    initialWorklogState: worklogState
  });
  harness.fetchQueue.push(
    jsonResponse(source),
    jsonResponse(current),
    jsonResponse({ ...current, stop: new Date().toISOString(), duration: 600 }),
    jsonResponse({ worklogs: [], total: 0 }),
    jsonResponse({ id: "other-worklog", timeSpentSeconds: 600 }),
    jsonResponse({ id: 7153, workspace_id: 123, description: source.description, duration: -1 })
  );

  const result = await harness.context.handleMessage(
    { type: "START_TODAY_APPOINTMENT", sourceEntryId: source.id },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.action, "started");
  assert.equal(result.previousWorklogSync.issueKey, "OTHER-7");
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["7152"].status, "synced");
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["7153"].issueKey, "PROJ-123");
  assert.deepEqual(harness.requests.map((request) => request.method), [
    "GET", "GET", "PATCH", "GET", "POST", "POST"
  ]);
});

test("replayed Jira appointments keep their issue association for the next Work Log", async () => {
  const now = Date.now();
  const source = {
    id: 7201,
    workspace_id: 123,
    description: "Custom Jira timer description",
    start: new Date(now - 3_600_000).toISOString(),
    stop: new Date(now - 1_800_000).toISOString(),
    duration: 1800
  };
  const created = {
    id: 7202,
    workspace_id: 123,
    description: source.description,
    start: new Date().toISOString(),
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings({ syncWorklogs: true }),
    initialWorklogState: {
      version: 1,
      entries: {
        "7201": {
          togglEntryId: 7201,
          workspaceId: 123,
          jiraOrigin: JIRA_ORIGIN,
          issueKey: "PROJ-123",
          description: source.description,
          status: "synced",
          worklogId: "old-worklog",
          updatedAt: source.stop
        }
      }
    }
  });
  harness.fetchQueue.push(jsonResponse(source), jsonResponse(null), jsonResponse(created));

  await harness.context.handleMessage(
    { type: "START_TODAY_APPOINTMENT", sourceEntryId: source.id },
    harness.extensionSender("popup.html")
  );

  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["7202"].issueKey, "PROJ-123");
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["7202"].status, "running");

  harness.fetchQueue.push(
    jsonResponse(created),
    jsonResponse({ ...created, stop: new Date().toISOString(), duration: 120 }),
    jsonResponse({ worklogs: [], total: 0 }),
    jsonResponse({ id: "new-worklog", timeSpentSeconds: 120 })
  );
  const stopped = await harness.context.handleMessage(
    { type: "STOP_CURRENT_TIMER" },
    harness.extensionSender("popup.html")
  );

  assert.equal(stopped.worklogSync.status, "synced");
  assert.equal(stopped.worklogSync.issueKey, "PROJ-123");
  assert.equal(harness.storage[WORKLOG_STATE_KEY].entries["7202"].status, "synced");
});

test("Jira-looking manual appointments remain Toggl-only when replayed", async () => {
  const now = Date.now();
  const source = {
    id: 7301,
    workspace_id: 123,
    description: "[OPS-9] Manually typed",
    start: new Date(now - 3_600_000).toISOString(),
    stop: new Date(now - 1_800_000).toISOString(),
    duration: 1800
  };
  const harness = createHarness({
    initialSettings: configuredSettings({ syncWorklogs: true })
  });
  harness.fetchQueue.push(
    jsonResponse(source),
    jsonResponse(null),
    jsonResponse({ id: 7302, workspace_id: 123, description: source.description, duration: -1 })
  );

  await harness.context.handleMessage(
    { type: "START_TODAY_APPOINTMENT", sourceEntryId: source.id },
    harness.extensionSender("popup.html")
  );

  assert.equal(Object.hasOwn(harness.storage, WORKLOG_STATE_KEY), false);
});

test("appointment replay rejects untrusted, invalid, and stale selections before stopping a timer", async () => {
  const harness = createHarness({ initialSettings: configuredSettings() });

  await assert.rejects(
    harness.context.handleMessage(
      { type: "START_TODAY_APPOINTMENT", sourceEntryId: 1 },
      harness.jiraSender()
    ),
    /unauthorized source/i
  );
  await assert.rejects(
    harness.context.handleMessage(
      { type: "START_TODAY_APPOINTMENT", sourceEntryId: "invalid" },
      harness.extensionSender("popup.html")
    ),
    /positive integer/i
  );

  harness.fetchQueue.push(jsonResponse({
    id: 7401,
    workspace_id: 123,
    description: "Old appointment",
    start: "2020-01-01T10:00:00Z",
    stop: "2020-01-01T11:00:00Z",
    duration: 3600
  }));
  await assert.rejects(
    harness.context.handleMessage(
      { type: "START_TODAY_APPOINTMENT", sourceEntryId: 7401 },
      harness.extensionSender("popup.html")
    ),
    /today/i
  );
  assert.equal(harness.requests.length, 1);
});

test("switches to the running icon on start and restores the default on stop", async () => {
  const running = {
    id: 12000,
    workspace_id: 123,
    description: "Active timer",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(jsonResponse(null), jsonResponse(running));

  await harness.context.handleMessage(
    { type: "START_MANUAL_TIMER", description: "Active timer" },
    harness.extensionSender("popup.html")
  );
  assert.deepEqual(harness.actionIconUpdates.at(-1), {
    16: "icons/icon-running16.png",
    32: "icons/icon-running32.png",
    48: "icons/icon-running48.png",
    128: "icons/icon-running128.png"
  });

  harness.fetchQueue.push(
    jsonResponse(running),
    jsonResponse({
      ...running,
      stop: "2026-08-20T10:30:00Z",
      duration: 1800
    })
  );
  await harness.context.handleMessage(
    { type: "STOP_CURRENT_TIMER" },
    harness.extensionSender("popup.html")
  );
  assert.deepEqual(harness.actionIconUpdates.at(-1), {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png"
  });
});

test("restores the running icon from Toggl when the browser starts", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(jsonResponse({
    id: 12001,
    workspace_id: 123,
    description: "Already running",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  }));

  harness.listeners.startup();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(harness.requests[0].url, /\/me\/time_entries\/current$/);
  assert.equal(
    harness.actionIconUpdates.at(-1)["16"],
    "icons/icon-running16.png"
  );
});

test("does not let a stale timer lookup overwrite a newer icon state", async () => {
  const harness = createHarness();
  let resolveCurrent;
  harness.fetchQueue.push(() => new Promise((resolve) => {
    resolveCurrent = resolve;
  }));

  const pendingLookup = harness.context.getCurrentTimeEntry("test-token");
  await harness.context.setActionIcon(false);
  resolveCurrent(jsonResponse({
    id: 12002,
    start: "2026-08-20T10:00:00Z",
    duration: -1
  }));
  await pendingLookup;

  assert.equal(harness.actionIconUpdates.at(-1)["16"], "icons/icon16.png");
});

test("a daily-entry API failure does not break current timer controls", async () => {
  const current = {
    id: 12001,
    workspace_id: 123,
    description: "Current work without a Jira key",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse(current),
    jsonResponse({ message: "temporary failure" }, 500)
  );

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.current.id, 12001);
  assert.equal(result.workedToday.status, "error");
  assert.match(result.workedToday.message, /Timer controls still work/);
  assert.equal(result.jira.status, "not-applicable");
});

test("queries current-user entries from the local week lookback through now", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(jsonResponse(null), jsonResponse([]));

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.workedToday.status, "ok");
  const weeklyRequest = harness.requests.find((request) =>
    request.url.includes("/api/v9/me/time_entries?")
  );
  assert.ok(weeklyRequest);
  const url = new URL(weeklyRequest.url);
  const start = new Date(url.searchParams.get("start_date"));
  const end = new Date(url.searchParams.get("end_date"));
  assert.equal(start.getDay(), 0);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.ok(end.getTime() >= start.getTime());
});

test("detects the current Jira issue from the stored Toggl association first", async () => {
  const current = {
    id: 13001,
    workspace_id: 123,
    description: "Description deliberately has no issue key",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings(),
    initialWorklogState: {
      version: 1,
      entries: {
        "13001": {
          togglEntryId: 13001,
          workspaceId: 123,
          jiraOrigin: JIRA_ORIGIN,
          issueKey: "ECP-3217",
          description: current.description,
          status: "running"
        }
      }
    },
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse(current),
    jsonResponse([]),
    jsonResponse({
      key: "ECP-3217",
      fields: {
        summary: "Example Jira issue title",
        description: "Plain Jira description",
        timespent: 19800,
        timeoriginalestimate: 28800,
        timeestimate: 9000
      }
    })
  );

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.jira.status, "ok");
  assert.equal(result.jira.detection, "association");
  assert.equal(result.jira.issueKey, "ECP-3217");
  assert.equal(result.jira.loggedSeconds, 19800);
  assert.equal(result.jira.originalEstimateSeconds, 28800);
  assert.equal(result.jira.remainingEstimateSeconds, 9000);
  assert.equal(Object.hasOwn(result.jira, "clipboardText"), false);
  const jiraRequest = harness.requests.find((request) => request.url.includes("/rest/api/"));
  assert.doesNotMatch(new URL(jiraRequest.url).searchParams.get("fields"), /description/);
});

test("prepares Jira clipboard text only for the authorized Jira page", async () => {
  const harness = createHarness({ initialSettings: configuredSettings() });
  harness.fetchQueue.push(jsonResponse({
    key: "PROJ-123",
    fields: {
      summary: "Improve onboarding",
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Ship it" }] }]
      }
    }
  }));

  const result = await harness.context.handleMessage(
    { type: "GET_JIRA_CLIPBOARD", issueKey: "proj-123" },
    harness.jiraSender()
  );

  assert.equal(result.issueKey, "PROJ-123");
  assert.equal(
    result.clipboardText,
    "Title:\n```text\n[PROJ-123] Improve onboarding\n```\n\nDescription:\n```md\nShip it\n```"
  );
  const url = new URL(harness.requests[0].url);
  assert.equal(url.searchParams.get("fields"), "summary,description");

  await assert.rejects(
    harness.context.handleMessage(
      { type: "GET_JIRA_CLIPBOARD", issueKey: "PROJ-123" },
      harness.extensionSender("popup.html")
    ),
    /authorized Jira site/i
  );
  await assert.rejects(
    harness.context.handleMessage(
      { type: "GET_JIRA_CLIPBOARD", issueKey: "not-a-key" },
      harness.jiraSender()
    ),
    /issue key/i
  );
  assert.equal(harness.requests.length, 1);
});

test("uses the authorized Jira settings snapshot for clipboard requests", async () => {
  const harness = createHarness({ initialSettings: configuredSettings() });
  const originalGet = harness.context.chrome.storage.local.get;
  let settingsReads = 0;
  harness.context.chrome.storage.local.get = async (key) => {
    const value = await originalGet(key);
    if (key === STORAGE_KEY && settingsReads++ === 0) {
      harness.storage[STORAGE_KEY] = configuredSettings({
        jiraOrigin: "https://other-example.atlassian.net"
      });
    }
    return value;
  };
  harness.fetchQueue.push(jsonResponse({
    key: "PROJ-123",
    fields: { summary: "Authorized issue", description: null }
  }));

  await harness.context.handleMessage(
    { type: "GET_JIRA_CLIPBOARD", issueKey: "PROJ-123" },
    harness.jiraSender()
  );

  assert.equal(new URL(harness.requests[0].url).origin, JIRA_ORIGIN);
});

test("falls back to a conservative Jira key parsed from the Toggl description", async () => {
  const current = {
    id: 13002,
    workspace_id: 123,
    description: "Planning [abc_2-42] with the team",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse(current),
    jsonResponse([]),
    jsonResponse({
      key: "ABC_2-42",
      fields: {
        summary: "Fallback issue",
        description: null,
        timetracking: {}
      }
    })
  );

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.jira.status, "ok");
  assert.equal(result.jira.detection, "description");
  assert.equal(result.jira.issueKey, "ABC_2-42");
});

test("prefers Jira time-tracking seconds and preserves over-estimate values", () => {
  const harness = createHarness();
  const values = harness.context.extractJiraTimeTracking({
    timetracking: {
      timeSpentSeconds: 36000,
      originalEstimateSeconds: 28800,
      remainingEstimateSeconds: 1200
    },
    timespent: 1,
    timeoriginalestimate: 2,
    timeestimate: 3
  });

  assert.equal(values.loggedSeconds, 36000);
  assert.equal(values.originalEstimateSeconds, 28800);
  assert.equal(values.remainingEstimateSeconds, 1200);
});

test("handles missing logged time, missing estimates, and Jira remaining estimates", () => {
  const harness = createHarness();
  const missingLogged = harness.context.extractJiraTimeTracking({
    timeoriginalestimate: 7200
  });
  assert.equal(missingLogged.loggedSeconds, 0);
  assert.equal(missingLogged.originalEstimateSeconds, 7200);
  assert.equal(missingLogged.remainingEstimateSeconds, null);

  const missingOriginal = harness.context.extractJiraTimeTracking({
    timespent: 19800,
    timeestimate: 3600
  });
  assert.equal(missingOriginal.loggedSeconds, 19800);
  assert.equal(missingOriginal.originalEstimateSeconds, null);
  assert.equal(missingOriginal.remainingEstimateSeconds, 3600);
});

test("falls back from Jira REST v3 to v2 when loading popup insights", async () => {
  const current = {
    id: 13003,
    workspace_id: 123,
    description: "[PROJ-123] Compatible Jira",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse(current),
    jsonResponse([]),
    jsonResponse({ errorMessages: ["v3 unavailable"] }, 404),
    jsonResponse({
      key: "PROJ-123",
      fields: {
        summary: "Compatible issue",
        description: "v2 description",
        timespent: 600,
        timeoriginalestimate: 1200
      }
    })
  );

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.jira.status, "ok");
  const jiraRequests = harness.requests.filter((request) => request.url.includes("/issue/PROJ-123?"));
  assert.match(jiraRequests[0].url, /\/rest\/api\/3\//);
  assert.match(jiraRequests[1].url, /\/rest\/api\/2\//);
});

test("a Jira progress API failure does not prevent the timer from being stopped", async () => {
  const current = {
    id: 13004,
    workspace_id: 123,
    description: "[PROJ-123] Jira unavailable",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(
    jsonResponse(current),
    jsonResponse([]),
    jsonResponse({ message: "Jira unavailable" }, 500)
  );

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.current.id, 13004);
  assert.equal(result.jira.status, "error");
  assert.match(result.jira.message, /still stop the timer/);
});

test("does not request Jira details for a current timer without a ticket", async () => {
  const current = {
    id: 13005,
    workspace_id: 123,
    description: "General planning and notes",
    start: "2026-08-20T10:00:00Z",
    duration: -1
  };
  const harness = createHarness({
    initialSettings: configuredSettings(),
    permissions: [JIRA_MATCH]
  });
  harness.fetchQueue.push(jsonResponse(current), jsonResponse([]));

  const result = await harness.context.handleMessage(
    { type: "GET_POPUP_STATE" },
    harness.extensionSender("popup.html")
  );

  assert.equal(result.jira.status, "not-applicable");
  assert.equal(
    harness.requests.filter((request) => request.url.includes("/rest/api/")).length,
    0
  );
});

test("converts plain Jira descriptions and empty descriptions to Markdown", () => {
  const harness = createHarness();
  assert.equal(harness.context.adfToMarkdown("Plain Jira description"), "Plain Jira description");
  assert.equal(harness.context.adfToMarkdown(""), "(No description)");
  assert.equal(harness.context.adfToMarkdown(null), "(No description)");
});

test("converts ADF paragraphs, headings, hard breaks, and horizontal rules", () => {
  const harness = createHarness();
  const markdown = harness.context.adfToMarkdown({
    type: "doc",
    version: 1,
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Overview" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "First line" },
          { type: "hardBreak" },
          { type: "text", text: "Second line" }
        ]
      },
      { type: "rule" }
    ]
  });

  assert.equal(markdown, "## Overview\n\nFirst line\\\nSecond line\n\n---");
});

test("converts nested ADF bullet and ordered lists", () => {
  const harness = createHarness();
  const markdown = harness.context.adfToMarkdown({
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
              {
                type: "orderedList",
                attrs: { order: 2 },
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Child" }] }] }
                ]
              }
            ]
          }
        ]
      }
    ]
  });

  assert.equal(markdown, "- Parent\n  2. Child");
});

test("converts common ADF text marks and links", () => {
  const harness = createHarness();
  const markdown = harness.context.adfToMarkdown({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Bold", marks: [{ type: "strong" }] },
          { type: "text", text: " italic", marks: [{ type: "em" }] },
          { type: "text", text: " code", marks: [{ type: "code" }] },
          { type: "text", text: " strike", marks: [{ type: "strike" }] },
          {
            type: "text",
            text: " link",
            marks: [{ type: "link", attrs: { href: "https://example.test/docs" } }]
          }
        ]
      }
    ]
  });

  assert.equal(
    markdown,
    "**Bold*** italic*` code`~~ strike~~[ link](https://example.test/docs)"
  );
});

test("converts ADF code blocks, blockquotes, mentions, emoji, and task items", () => {
  const harness = createHarness();
  const markdown = harness.context.adfToMarkdown({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { language: "js" },
        content: [{ type: "text", text: "const marker = ```;" }]
      },
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }]
      },
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { text: "@Alex" } },
          { type: "text", text: " " },
          { type: "emoji", attrs: { text: "🙂" } }
        ]
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { state: "DONE" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Ship it" }] }]
          }
        ]
      }
    ]
  });

  assert.match(markdown, /````js\nconst marker = ```;\n````/);
  assert.match(markdown, /> Quoted/);
  assert.match(markdown, /@Alex 🙂/);
  assert.match(markdown, /- \[x\] Ship it/);
});

test("converts ADF tables and safely degrades unknown nodes through their children", () => {
  const harness = createHarness();
  const markdown = harness.context.adfToMarkdown({
    type: "doc",
    content: [
      {
        type: "unknownPanel",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Preserved child" }] }]
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }] }
            ]
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }
            ]
          }
        ]
      }
    ]
  });

  assert.match(markdown, /^Preserved child/);
  assert.match(markdown, /\| Name \| Value \|/);
  assert.match(markdown, /\| --- \| --- \|/);
  assert.match(markdown, /\| A \| B \|/);
});

test("builds the exact Jira clipboard document structure", () => {
  const harness = createHarness();
  const document = harness.context.buildJiraClipboardDocument({
    issueKey: "ECP-3217",
    summary: "Example Jira issue title",
    descriptionMarkdown: "The Jira description converted to Markdown."
  });

  assert.equal(document, [
    "Title:",
    "```text",
    "[ECP-3217] Example Jira issue title",
    "```",
    "",
    "Description:",
    "```md",
    "The Jira description converted to Markdown.",
    "```"
  ].join("\n"));
});

test("uses an outer clipboard fence longer than backticks in Jira content", () => {
  const harness = createHarness();
  const document = harness.context.buildJiraClipboardDocument({
    issueKey: "ECP-3217",
    summary: "Backtick example",
    descriptionMarkdown: "Use ```javascript\nconst value = 1;\n``` here."
  });

  assert.match(document, /Description:\n````md\nUse ```javascript/);
  assert.match(document, /``` here\.\n````$/);
});
