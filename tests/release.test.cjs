"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("GitHub releases prepend the matching changelog to generated notes", () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, ".github/workflows/release.yml"),
    "utf8"
  );
  const changelogNotes = workflow.indexOf('--notes "${changelog}"');
  const generatedNotes = workflow.indexOf("--generate-notes");

  assert.match(workflow, /awk -v version="\$\{version\}"[\s\S]*CHANGELOG\.md/);
  assert.ok(changelogNotes >= 0, "expected changelog content in the release body");
  assert.ok(generatedNotes > changelogNotes, "expected generated compare notes afterward");
});
