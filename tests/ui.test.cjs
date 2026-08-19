"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

test("settings page includes the direct Toggl API token link", () => {
  const html = read("options.html");
  assert.match(html, /https:\/\/track\.toggl\.com\/profile#api-token/);
  assert.match(html, /Open the Toggl API Token page/);
});

test("settings page exposes every supported template variable as an insert button", () => {
  const html = read("options.html");
  const variables = [
    "key",
    "summary",
    "url",
    "projectKey",
    "projectName",
    "issueNumber",
    "issueType",
    "status",
    "assignee",
    "reporter",
    "priority",
    "parentKey",
    "labels",
    "components"
  ];

  for (const variable of variables) {
    assert.match(html, new RegExp(`data-variable="\\{${variable}\\}"`));
  }
});

test("popup contains a manual timer form shown when no timer is running", () => {
  const html = read("popup.html");
  const script = read("popup.js");

  assert.match(html, /id="manual-form"/);
  assert.match(html, /id="manual-description"/);
  assert.match(html, /id="start"/);
  assert.match(script, /type: "START_MANUAL_TIMER"/);
  assert.match(script, /manualElement\.classList\.remove\("hidden"\)/);
});

test("manifest uses runtime Jira host permission and has no hard-coded company Jira host", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const source = [
    read("manifest.json"),
    read("background.js"),
    read("content.js"),
    read("options.html"),
    read("options.js"),
    read("popup.html"),
    read("popup.js")
  ].join("\n");

  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
  assert.deepEqual(manifest.host_permissions, ["https://api.track.toggl.com/*"]);
  assert.doesNotMatch(read("manifest.json"), /[a-z0-9-]+\.atlassian\.net/i);
});

test("extension pages and primary actions are presented in English", () => {
  const optionsHtml = read("options.html");
  const popupHtml = read("popup.html");
  const contentScript = read("content.js");

  assert.match(optionsHtml, /<html lang="en">/);
  assert.match(popupHtml, /<html lang="en">/);
  assert.match(optionsHtml, />Connect and save</);
  assert.match(popupHtml, />Start timer</);
  assert.match(contentScript, /Start in Toggl/);
  assert.match(contentScript, /Stop in Toggl/);
});

test("settings page prominently discloses Jira-to-Toggl data use before saving", () => {
  const html = read("options.html");
  const disclosureIndex = html.indexOf('id="data-use-title"');
  const saveIndex = html.indexOf('id="save-button"');

  assert.ok(disclosureIndex >= 0, "expected a visible data-use disclosure");
  assert.ok(saveIndex > disclosureIndex, "disclosure should appear before the save action");
  assert.match(html, /reads only the issue fields needed by\s+your description template/i);
  assert.match(html, /sends the resulting timer description/i);
  assert.match(html, /Nothing is\s+sent to the extension developer/i);
});

test("manifest and package versions stay aligned", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.version, manifest.version);
});

test("extension HTML loads only local executable scripts", () => {
  for (const filename of ["options.html", "popup.html"]) {
    const html = read(filename);
    const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)]
      .map((match) => match[1]);

    assert.ok(scriptSources.length > 0, `${filename} should load a local script`);
    for (const source of scriptSources) {
      assert.doesNotMatch(source, /^(?:https?:)?\/\//i);
      assert.doesNotMatch(source, /^data:/i);
    }
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i);
  }
});
