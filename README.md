# Jira → Toggl Quick Start


[![CI](https://github.com/cleissonom/jira-toggl-quickstart/actions/workflows/ci.yml/badge.svg)](https://github.com/cleissonom/jira-toggl-quickstart/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Independent open-source project. Not affiliated with, endorsed by, or sponsored by Atlassian or Toggl.

A lightweight Manifest V3 Chrome extension that starts and stops Toggl Track timers from Jira issues or from a manual description entered in the toolbar popup.

For a Jira issue such as `PROJ-123 — Improve the onboarding workflow`, the default timer description is:

```text
[PROJ-123] Improve the onboarding workflow
```

## Features

- One-click **Start in Toggl** and **Stop in Toggl** button inside Jira.
- Manual timer field in the extension popup when no timer is running.
- Configurable Jira site; paste a site, board, backlog, or issue URL.
- Runtime permission for the exact configured Jira origin instead of a company-specific hard-coded URL.
- Configurable **Billable** default for every time entry created by the extension.
- Automatic default-workspace detection.
- Optional fixed Toggl project.
- Custom Jira description templates with fourteen supported variables.
- Optional automatic switching: stop the current timer before starting a different one.
- English UI, source code, comments, tests, and documentation.
- No backend, analytics, remote scripts, or third-party runtime dependencies.

## Install for local development

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project directory.
6. Complete the settings page that opens automatically.

After changing source files, click **Reload** on the extension card and reload any Jira tabs that were already open.

## Quick setup

The main settings form keeps only the common choices visible:

1. **Jira site URL** — paste any URL from the Jira site. The extension normalizes it to its HTTPS origin.
2. **Toggl Track API token** — use the direct **Open the Toggl API Token page** link below the field.
3. **Billable time entries** — choose whether timers created by the extension should be billable by default.

Click **Connect and save**. The extension requests access only to the exact Jira origin entered, validates the Toggl token, detects the default workspace, and registers its Jira content script.

The collapsed **Advanced settings** section contains:

- Workspace ID override.
- Optional fixed Toggl project ID.
- Jira description template and click-to-insert variables.
- Automatic timer switching.

## Daily use

### Start from Jira

1. Open a Jira issue or select one from a board or backlog.
2. Click the floating **Start in Toggl** button.
3. Click **Stop in Toggl** when the same issue is running.

### Start a manual timer

1. Open the extension from the Chrome toolbar.
2. When no timer is running, type a description in **What are you working on?**.
3. Click **Start timer** or press Enter.

Manual timers use the same saved workspace, optional project, Billable default, and automatic-switching behavior as Jira timers.

## Description template variables

The default remains:

```text
[{key}] {summary}
```

Available variables:

| Variable | Value |
| --- | --- |
| `{key}` | Full issue key, for example `PROJ-123` |
| `{summary}` | Jira issue summary |
| `{url}` | Canonical Jira browse URL |
| `{projectKey}` | Jira project key, for example `PROJ` |
| `{projectName}` | Jira project name |
| `{issueNumber}` | Numeric part of the issue key, for example `123` |
| `{issueType}` | Issue type, such as Story or Bug |
| `{status}` | Current Jira status |
| `{assignee}` | Assignee display name |
| `{reporter}` | Reporter display name |
| `{priority}` | Jira priority |
| `{parentKey}` | Parent issue key when available |
| `{labels}` | Comma-separated labels |
| `{components}` | Comma-separated component names |

Optional values that Jira does not return are replaced with empty text. Unknown variable names are rejected when settings are saved, which helps catch template typos.

Example:

```text
{projectKey}-{issueNumber} · {issueType} · {summary} · {status}
```

## How it works

```text
Jira page content script
    │
    ├── detects the issue key
    ├── reads selected Jira fields through the authenticated browser session
    ├── renders the floating timer button
    └── sends a constrained extension message
             │
             ▼
Manifest V3 service worker
    │
    ├── validates the configured Jira origin or trusted extension page
    ├── reads protected local settings
    ├── checks the current Toggl timer
    └── starts or stops a Toggl time entry
```

The content script tries Jira REST API versions `3`, `2`, and `latest`, then falls back to the visible Jira page for the summary when necessary.

## Permissions and privacy

### Required permissions

- `storage` — saves the token and preferences in the current Chrome profile.
- `scripting` — dynamically registers `content.js` for the configured Jira site.
- `https://api.track.toggl.com/*` — calls the Toggl Track API.

### Optional Jira host permission

The manifest allows the settings page to request an HTTPS host at runtime. Chrome displays the exact Jira site being requested. The extension stores only the configured origin and registers its content script only for that origin.

### Token handling

The Toggl API token is stored in `chrome.storage.local`. The service worker calls:

```javascript
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
```

This prevents the Jira content script from directly reading extension storage. The token is never returned to the Jira page.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for more details.

## Development

No package installation is required. Run:

```bash
npm run validate
```

This command checks JavaScript syntax, validates `manifest.json`, and runs the mocked service-worker and UI contract tests.

## Project structure

```text
manifest.json       Manifest V3 configuration and permissions
background.js       Toggl integration, settings, permissions, and security
content.js          Jira issue detection, metadata lookup, and floating button
options.*           Simple setup page and advanced preferences
popup.*             Current timer, manual start field, and stop action
icons/              Local extension icons
tests/              Mocked service-worker and UI contract tests
PRIVACY.md          Data-handling disclosure
SECURITY.md         Security design and reporting guidance
CONTRIBUTING.md     Contribution workflow
CHANGELOG.md        Release notes
LICENSE             MIT license
```

## APIs used

- Chrome Extensions Manifest V3
- Jira issue endpoint: `GET /rest/api/{version}/issue/{issueKey}?fields=...`
- Toggl Track API v9:
  - `GET /api/v9/me`
  - `GET /api/v9/workspaces/{workspace_id}`
  - `GET /api/v9/workspaces/{workspace_id}/projects/{project_id}`
  - `GET /api/v9/me/time_entries/current`
  - `POST /api/v9/workspaces/{workspace_id}/time_entries`
  - `PATCH /api/v9/workspaces/{workspace_id}/time_entries/{time_entry_id}/stop`

Official references:

- https://developer.chrome.com/docs/extensions/reference/api/permissions
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
- https://engineering.toggl.com/docs/track/authentication/
- https://engineering.toggl.com/docs/track/api/time_entries/

## Compatibility

- Chrome 102 or newer.
- Jira sites served over HTTPS.
- Jira Cloud is the primary target. Jira deployments exposing compatible REST v2 or `latest` issue endpoints may also work.
- Toggl Track API tokens.


## Publishing and releases

- [RELEASING.md](RELEASING.md) describes versioning, tags, and automated GitHub releases.
- [STORE_LISTING.md](STORE_LISTING.md) contains the Chrome Web Store description, permission justifications, privacy declarations, and remaining listing assets.
- A tag such as `v0.3.0` triggers the release workflow, which validates the source and creates a minimal Chrome Web Store ZIP plus its SHA-256 checksum.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

MIT — see [LICENSE](LICENSE).
