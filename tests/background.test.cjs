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
  const listeners = {};
  let optionsOpenCount = 0;
  let accessLevel = null;

  const chrome = {
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
    extensionSender(page = "popup.html") {
      return {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/${page}`
      };
    }
  };
}

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
    worklogRounding: "exact",
    worklogCommentTemplate: "Synced from Toggl: {description}",
    ...overrides
  };
}

test("saves a configurable Jira origin, billable default, and protected Toggl token", async () => {
  const harness = createHarness({ permissions: [JIRA_MATCH] });
  harness.fetchQueue.push(
    jsonResponse({ default_workspace_id: 123, fullname: "Dev QA" }),
    jsonResponse({ id: 123, name: "Workspace QA" }),
    jsonResponse({ id: 456, workspace_id: 123, name: "Internal Engineering" })
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

  assert.equal(harness.requests.length, 3);
  assert.equal(harness.requests[0].url, "https://api.track.toggl.com/api/v9/me");
  assert.equal(
    harness.requests[0].headers.Authorization,
    `Basic ${btoa("test-token:api_token")}`
  );
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
});


test("creates an exact Jira Work Log when a Jira timer stops", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({
      syncWorklogs: true,
      worklogSyncMode: "automatic",
      worklogRounding: "exact",
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
    jsonResponse({ id: "70001", timeSpentSeconds: 2525 })
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
  assert.match(jiraPost.url, /adjustEstimate=leave/);
  assert.match(jiraPost.url, /notifyUsers=false/);
  assert.equal(jiraPost.credentials, "include");
  assert.equal(jiraPost.cache, "no-store");

  const body = JSON.parse(jiraPost.body);
  assert.equal(body.timeSpentSeconds, 2525);
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

test("applies the configured Jira Work Log rounding modes", () => {
  const harness = createHarness();
  assert.equal(harness.context.applyWorklogRounding(89, "exact"), 89);
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
          worklogRounding: "exact",
          worklogCommentTemplate: "Synced from {unknownValue}"
        }
      },
      harness.extensionSender("options.html")
    ),
    (error) => error?.code === "UNKNOWN_WORKLOG_COMMENT_VARIABLE"
  );

  assert.equal(harness.requests.length, 0);
});

test("requires a positive Toggl project ID before saving settings", async () => {
  const harness = createHarness({ permissions: [JIRA_MATCH] });

  await assert.rejects(
    harness.context.handleMessage(
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
    ),
    (error) => error?.code === "MISSING_PROJECT_ID"
  );

  assert.equal(harness.requests.length, 0);
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

test("opens Settings after an upgrade when the saved project ID is missing", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({ projectId: null, projectName: "" }),
    permissions: [JIRA_MATCH]
  });

  harness.listeners.installed({ reason: "update" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.optionsOpenCount, 1);
});

test("blocks new timers while upgraded settings are missing a project", async () => {
  const harness = createHarness({
    initialSettings: configuredSettings({ projectId: null, projectName: "" }),
    permissions: [JIRA_MATCH]
  });

  await assert.rejects(
    harness.context.handleMessage(
      { type: "START_MANUAL_TIMER", description: "Blocked work" },
      harness.extensionSender("popup.html")
    ),
    (error) => error?.code === "CONFIG_NOT_SET"
  );

  assert.equal(harness.requests.length, 0);
});

test("keeps an upgraded running timer readable and stoppable without a project", async () => {
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

  assert.equal(popup.settings.togglConfigured, false);
  assert.equal(popup.settings.configurationRequired, "project");
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

test("queries all current-user entries between local midnight and now", async () => {
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
  const dailyRequest = harness.requests.find((request) =>
    request.url.includes("/api/v9/me/time_entries?")
  );
  assert.ok(dailyRequest);
  const url = new URL(dailyRequest.url);
  const start = new Date(url.searchParams.get("start_date"));
  const end = new Date(url.searchParams.get("end_date"));
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
