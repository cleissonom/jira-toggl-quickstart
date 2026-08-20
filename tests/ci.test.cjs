"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("release workflow uses the tag as the GitHub release title", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/release.yml"), "utf8");
  assert.match(workflow, /--title "\$\{GITHUB_REF_NAME\}"/);
});
