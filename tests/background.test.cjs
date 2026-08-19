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
    projectId: null,
    projectName: "",
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
    jsonResponse({ id: 123, name: "Workspace QA" })
  );

  const result = await harness.context.handleMessage(
    {
      type: "VALIDATE_AND_SAVE_SETTINGS",
      settings: {
        jiraOrigin: `${JIRA_ORIGIN}/jira/software/c/projects/ECP/boards/754/backlog`,
        apiToken: "test-token",
        workspaceId: "",
        projectId: "",
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

  assert.equal(harness.requests.length, 2);
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
  harness.fetchQueue.push(jsonResponse(null));

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
    jsonResponse({ id: "70004" })
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
