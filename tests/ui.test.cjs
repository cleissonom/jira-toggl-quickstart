"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

function readPngData(buffer) {
  const imageChunks = [];

  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      imageChunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }

  return zlib.inflateSync(Buffer.concat(imageChunks));
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function filterPredictor(filter, left, above, upperLeft) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return above;
  if (filter === 3) return Math.floor((left + above) / 2);
  if (filter === 4) return paethPredictor(left, above, upperLeft);
  throw new Error(`unsupported PNG filter: ${filter}`);
}

function decodeRgbaPng(buffer) {
  assert.equal(buffer[24], 8, "expected an 8-bit PNG");
  assert.equal(buffer[25], 6, "expected an RGBA PNG");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const rowLength = width * 4;
  const filtered = readPngData(buffer);
  const pixels = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y += 1) {
    const source = y * (rowLength + 1);
    const target = y * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const left = x >= 4 ? pixels[target + x - 4] : 0;
      const above = y > 0 ? pixels[target + x - rowLength] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[target + x - rowLength - 4] : 0;
      const predictor = filterPredictor(filtered[source], left, above, upperLeft);
      pixels[target + x] = (filtered[source + x + 1] + predictor) & 0xff;
    }
  }

  return { height, pixels, width };
}

function countWhitePixels(image, left, top, right, bottom) {
  let count = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4;
      const pixel = image.pixels.subarray(offset, offset + 4);
      if (pixel.every((channel) => channel > 240)) count += 1;
    }
  }

  return count;
}

function readPixel(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [...image.pixels.subarray(offset, offset + 4)];
}

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
  assert.match(html, /Toggl entries for the current browser-local day/i);
  assert.match(html, /issue summary, description, logged time, and\s+estimates/i);
  assert.match(html, /copied only after\s+you click the copy button/i);
  assert.match(html, /Nothing is sent to the extension developer/i);
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

test("settings expose optional Jira Work Log synchronization controls", () => {
  const html = read("options.html");
  const script = read("options.js");

  assert.match(html, /id="sync-worklogs"/);
  assert.match(html, /id="worklog-sync-mode"/);
  assert.match(html, /value="automatic"/);
  assert.match(html, /value="manual"/);
  assert.match(html, /id="worklog-rounding"/);
  assert.doesNotMatch(html, /value="exact"/);
  assert.match(html, /value="nearest-minute"/);
  assert.match(html, /value="ceil-minute"/);
  assert.match(html, /data-worklog-variable="\{description\}"/);
  assert.match(html, /data-worklog-variable="\{issueKey\}"/);
  assert.match(html, /data-worklog-variable="\{togglId\}"/);
  assert.match(script, /syncWorklogs: syncWorklogsInput\.checked/);
  assert.match(script, /worklogSyncMode: worklogSyncModeInput\.value/);
});

test("popup exposes a local pending Work Log retry workflow", () => {
  const html = read("popup.html");
  const script = read("popup.js");

  assert.match(html, /id="worklogs"/);
  assert.match(html, /id="worklogs-list"/);
  assert.match(html, /id="sync-worklogs"/);
  assert.match(script, /type: "SYNC_PENDING_WORKLOGS"/);
  assert.match(script, /Work Logs apply only to timers started from the Jira button/);
});

test("Work Log data use is disclosed before settings are saved", () => {
  const html = read("options.html");
  const disclosureIndex = html.indexOf('id="data-use-title"');
  const saveIndex = html.indexOf('id="save-button"');

  assert.ok(disclosureIndex >= 0);
  assert.ok(saveIndex > disclosureIndex);
  assert.match(html, /If Work Log sync is enabled/i);
  assert.match(html, /stopped duration, start\s+time/i);
  assert.match(html, /Retry records stay\s+in this Chrome profile/i);
});

test("all extension HTML ids are unique", () => {
  for (const filename of ["options.html", "popup.html"]) {
    const html = read(filename);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${filename} contains duplicate ids`);
  }
});

test("the replacement extension icons are valid PNGs at every manifest size", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const expectedSizes = [16, 32, 48, 128];

  for (const size of expectedSizes) {
    const relativePath = manifest.icons[String(size)];
    assert.equal(relativePath, `icons/icon${size}.png`);
    const buffer = fs.readFileSync(path.join(ROOT, relativePath));
    const runningPath = `icons/icon-running${size}.png`;
    const runningBuffer = fs.readFileSync(path.join(ROOT, runningPath));
    assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(buffer.readUInt32BE(16), size);
    assert.equal(buffer.readUInt32BE(20), size);
    assert.equal(runningBuffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(runningBuffer.readUInt32BE(16), size);
    assert.equal(runningBuffer.readUInt32BE(20), size);
    assert.notDeepEqual(runningBuffer, buffer);
  }

  assert.match(read("options.html"), /src="icons\/icon48\.png"/);
  assert.match(read("popup.html"), /src="icons\/icon32\.png"/);
});

test("running icons have transparent rounded corners", () => {
  for (const size of [16, 32, 48, 128]) {
    const icon = fs.readFileSync(path.join(ROOT, `icons/icon-running${size}.png`));
    assert.equal(decodeRgbaPng(icon).pixels[3], 0);
  }
});

test("normal icons have transparent rounded corners", () => {
  for (const size of [16, 32, 48, 128]) {
    const icon = fs.readFileSync(path.join(ROOT, `icons/icon${size}.png`));
    assert.equal(decodeRgbaPng(icon).pixels[3], 0);
  }
});

test("running icon keeps the stopwatch button above its face", () => {
  const icon = fs.readFileSync(path.join(ROOT, "icons/icon-running128.png"));
  const image = decodeRgbaPng(icon);
  const topButton = countWhitePixels(image, 70, 16, 94, 31);
  const bottomButton = countWhitePixels(image, 70, 97, 94, 112);

  assert.ok(topButton > bottomButton, "expected the stopwatch button at the top");
});

test("running icon uses the high-contrast 0.6.0 palette", () => {
  const icon = fs.readFileSync(path.join(ROOT, "icons/icon-running128.png"));
  const image = decodeRgbaPng(icon);

  assert.deepEqual(readPixel(image, 64, 8), [0, 0, 0, 255]);
  assert.deepEqual(readPixel(image, 24, 45), [26, 244, 252, 255]);
  assert.deepEqual(readPixel(image, 32, 56), [0, 0, 0, 255]);
  assert.deepEqual(readPixel(image, 10, 64), [0, 0, 0, 255]);
  assert.deepEqual(readPixel(image, 108, 64), [254, 253, 253, 255]);
  assert.deepEqual(readPixel(image, 62, 64), [0, 0, 0, 255]);
  assert.deepEqual(readPixel(image, 84, 68), [26, 244, 252, 255]);
});

test("release metadata is set to version 0.6.0", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(manifest.version, "0.6.0");
  assert.equal(packageJson.version, "0.6.0");
  assert.match(manifest.description, /daily and weekly totals/i);
  assert.match(read("CHANGELOG.md"), /## 0\.6\.0 — 2026-08-21/);
  assert.match(read(".github/ISSUE_TEMPLATE/bug_report.yml"), /placeholder: 0\.6\.0/);
});

test("extension stylesheets have balanced blocks and one Work Log settings block", () => {
  for (const filename of ["options.css", "popup.css"]) {
    const css = read(filename);
    assert.equal(
      [...css].filter((character) => character === "{").length,
      [...css].filter((character) => character === "}").length,
      `${filename} contains unbalanced braces`
    );
  }

  const optionsCss = read("options.css");
  assert.equal((optionsCss.match(/\.worklog-card\s*\{/g) || []).length, 1);
});

test("popup rounds both bottom corners by 16px", () => {
  const css = read("popup.css");
  const rootRule = css.match(/:root\s*\{([^}]*)\}/)?.[1] || "";
  const bodyRule = css.match(/body\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(rootRule, /background:\s*transparent/);
  assert.match(bodyRule, /border-bottom-left-radius:\s*16px/);
  assert.match(bodyRule, /border-bottom-right-radius:\s*16px/);
  assert.match(bodyRule, /overflow:\s*hidden/);
});

test("Toggl Project ID is optional and supports automatic selection", () => {
  const html = read("options.html");
  const projectIndex = html.indexOf('id="project-id"');
  const advancedIndex = html.indexOf('id="advanced-settings"');

  assert.ok(projectIndex >= 0);
  assert.ok(projectIndex < advancedIndex, "Project ID should appear before Advanced settings");
  assert.match(html, /project ID/i);
  assert.match(html, /optional/i);
  assert.match(html, /actual_hours/);
  assert.doesNotMatch(html, /id="project-id"[\s\S]*?required/);
  assert.doesNotMatch(html, /required-indicator/);
});

test("popup presents daily total and Jira details in the requested compact order", () => {
  const html = read("popup.html");
  const order = [
    'id="worked-today"',
    'id="timer"',
    'id="jira-progress"',
    'id="copy-jira"',
    'id="stop"',
    'id="worklogs"',
    'id="settings"'
  ].map((marker) => html.indexOf(marker));

  for (const index of order) {
    assert.ok(index >= 0);
  }
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /Worked today/);
  assert.match(html, /id="worked-week-value"/);
  assert.match(html, /Worked this week/);
  assert.match(html, /Jira progress/);
  assert.match(html, /Copy Jira title &amp; description/);
});

test("popup keeps live daily and weekly totals local and refreshes after timer changes", () => {
  const script = read("popup.js");
  assert.match(script, /getLiveWorkedSeconds/);
  assert.match(script, /calculatedAt/);
  assert.match(script, /window\.setInterval\(updateLiveValues, 1000\)/);
  assert.match(script, /await loadState\(\);\n  showWorklogResult\(worklogResult/);
  assert.match(script, /await loadState\(\);\n  if \(previousResult\)/);
});

test("Jira copy uses the explicit clipboard API without a broad permission", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const script = read("popup.js");

  assert.doesNotMatch(JSON.stringify(manifest.permissions), /clipboard/i);
  assert.match(script, /navigator\.clipboard\.writeText\(currentJiraInsight\.clipboardText\)/);
  assert.match(script, /Copied to clipboard/);
  assert.match(script, /Check clipboard access and try again/);
});

test("Jira pages prioritize stopping the current issue without requiring a project", () => {
  const script = read("content.js");
  const stopIndex = script.indexOf('const shouldStop = Boolean(state.timerStatus?.isCurrentIssue)');
  const configureIndex = script.indexOf('if (!shouldStop && state.timerStatus?.configured === false)');
  const renderStopIndex = script.indexOf('if (state.timerStatus?.isCurrentIssue)', script.indexOf('function render()'));
  const renderConfigureIndex = script.indexOf('if (state.timerStatus?.configured === false)', script.indexOf('function render()'));

  assert.ok(stopIndex >= 0 && configureIndex > stopIndex);
  assert.ok(renderStopIndex >= 0 && renderConfigureIndex > renderStopIndex);
  assert.doesNotMatch(script, /valid Toggl project ID is required/i);
});

test("release documentation describes the v0.6.0 timer insights and icon states", () => {
  const readme = read("README.md");
  const privacy = read("PRIVACY.md");
  const security = read("SECURITY.md");
  const store = read("STORE_LISTING.md");
  const changelog = read("CHANGELOG.md");
  const releasing = read("RELEASING.md");

  assert.match(changelog, /## 0\.6\.0 — 2026-08-21/);
  assert.match(readme, /active project.*highest `actual_hours`/i);
  assert.match(readme, /Worked today/);
  assert.match(readme, /Worked this week/);
  assert.match(readme, /high-contrast black, cyan, and white running-state toolbar icon/i);
  assert.match(readme, /rounded toolbar icons/i);
  assert.match(readme, /Jira's actual logged time/);
  assert.match(readme, /logged duration reduces the remaining estimate/i);
  assert.match(privacy, /browser-local Sunday preceding the current week/);
  assert.match(privacy, /summary, description, logged time, original estimate, and remaining estimate/);
  assert.match(privacy, /only after the user explicitly clicks/);
  assert.match(security, /no remote JavaScript, `eval`, `new Function`/);
  assert.match(store, /No clipboard permission is requested/);
  assert.match(releasing, /v0\.6\.0/);
  assert.match(releasing, /changelog.*generated comparison notes/i);
});

test("documentation consistently describes the optional automatic Toggl project", () => {
  const combined = [
    "README.md",
    "PRIVACY.md",
    "SECURITY.md",
    "STORE_LISTING.md",
    "RELEASING.md"
  ].map(read).join("\n");

  assert.match(combined, /optional project/i);
  assert.match(combined, /actual_hours/);
  assert.doesNotMatch(combined, /required Toggl project/i);
});
