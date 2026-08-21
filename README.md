# Jira → Toggl Quick Start

<p align="center">
  <img src="icons/icon128.png" width="128" height="128" alt="Jira → Toggl Quick Start icon" />
</p>

[![CI](https://github.com/cleissonom/jira-toggl-quickstart/actions/workflows/ci.yml/badge.svg)](https://github.com/cleissonom/jira-toggl-quickstart/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Independent open-source project. Not affiliated with, endorsed by, or sponsored by Atlassian or Toggl.

A lightweight Manifest V3 Chrome extension that starts and stops Toggl Track timers from Jira issues, shows daily and weekly Toggl totals plus Jira work insights in the popup, optionally mirrors completed Jira timers into Jira Work Logs, and supports manual Toggl timers.

For a Jira issue such as `PROJ-123 — Improve the onboarding workflow`, the default timer description is:

```text
[PROJ-123] Improve the onboarding workflow
```

## Features

- One-click **Start in Toggl** and **Stop in Toggl** button inside Jira.
- Optional one-way synchronization from completed Toggl timers to Jira Work Logs.
- Automatic Work Log creation or confirmation from the extension popup.
- Local retry queue for failed Work Log requests and duplicate prevention through a Jira Work Log property.
- Nearest-minute or round-up duration handling for Jira Work Logs.
- Manual timer field in the extension popup when no timer is running.
- Compact **Worked today** and **Worked this week** totals for the browser-local day and Monday–Sunday week, including completed and running Toggl entries from every project and workspace.
- Rounded toolbar icons, including a high-contrast black, cyan, and white running-state toolbar icon while a Toggl timer is active.
- Jira logged-time progress against the original estimate for the currently running Jira-linked timer.
- Explicit **Copy Jira title & description** action with local ADF-to-Markdown conversion.
- Configurable Jira site; paste a site, board, backlog, or issue URL.
- Runtime permission for the exact configured Jira origin instead of a company-specific hard-coded URL.
- Configurable **Billable** default for every time entry created by the extension.
- Automatic default-workspace detection and an optional Toggl project, with automatic selection of the most-used active project.
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

The main settings form keeps the common choices visible:

1. **Jira site URL** — paste any URL from the Jira site. The extension normalizes it to its HTTPS origin.
2. **Toggl Track API token** — use the direct **Open the Toggl API Token page** link below the field.
3. **Toggl project ID** — optional. Leave it blank to select the active project in the workspace with the highest `actual_hours`.
4. **Billable time entries** — choose whether timers created by the extension should be billable by default.
5. **Jira Work Logs** — optionally create a Work Log when a timer started from the Jira button stops.

Click **Connect and save**. The extension requests access only to the exact Jira origin entered, validates the Toggl token, detects or checks the selected workspace, reads related Toggl project data, and registers its Jira content script. An entered project ID is validated against the workspace. When the field is blank, the extension selects the active project in that workspace with the highest `actual_hours`; if none exists, timers remain usable without a project.

The collapsed **Advanced settings** section contains:

- Workspace ID override.
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

Manual timers use the same saved workspace, optional selected project, Billable default, and automatic-switching behavior as Jira timers. They are intentionally Toggl-only and are not associated with a Jira Work Log.

### Use the popup insights

The popup shows **Worked today** for the current browser-local calendar day and **Worked this week** for the current Monday–Sunday week through now. It requests the current user's Toggl entries from the preceding Sunday midnight through the current time so Sunday entries that cross into Monday are available, then clips the same response to each displayed period. It includes completed entries from every project and workspace and adds the elapsed portion of the running entry without double-counting it. While the popup remains open, both running totals advance locally after the initial request rather than repeatedly polling Toggl.

When the current Toggl entry is linked to a Jira issue, the popup also shows Jira's actual logged time against the original estimate. Time left is calculated as original estimate minus logged time, while a positive over-estimate amount is shown when logged time exceeds the original estimate. Missing estimates and Jira API failures are shown without disabling the Stop timer action.

After Jira details load, **Copy Jira title & description** creates a Markdown document containing the issue key, summary, and description. Jira Cloud Atlassian Document Format is converted locally; plain-string descriptions are also supported. Clipboard access occurs only after the user clicks the button.

Users upgrading from v0.5.0 keep any saved project. Profiles without a project can start timers normally; opening and saving Settings can populate the project automatically when related Toggl data contains an eligible active project.

## Jira Work Log synchronization

Work Log synchronization is disabled by default. Enable **Sync stopped Jira timers to Work Logs** in Settings when the configured Jira account should receive completed time entries.

The synchronization applies only to timers linked to a Jira issue by the extension:

- A timer started with the floating Jira button is linked to that issue.
- Stopping it from Jira, from the popup, or through automatic timer switching can create the Work Log.
- If that linked timer is stopped directly in Toggl, opening the extension popup reconciles it and attempts the Work Log synchronization.
- Timers entered manually in the popup are not guessed or matched to Jira issues.

Available behavior:

- **Automatic** — attempt the Jira Work Log as soon as the timer stops.
- **Ask before syncing** — keep the completed entry pending until **Sync pending Work Logs** is clicked in the popup.
- **Nearest minute** or **round up** — apply the selected rounding rule before sending the duration to Jira. Existing exact-second settings migrate to nearest-minute rounding.
- **Comment template** — use `{description}`, `{issueKey}`, and `{togglId}`, or leave it blank.

The extension uses Jira's automatic estimate adjustment when creating a Work Log, so the logged duration reduces the remaining estimate in the same way as Jira's normal Work Log flow. Failed requests remain in a local retry queue. A custom property containing the Toggl time-entry ID is attached to the Jira Work Log and checked before creation to reduce duplicate submissions.

Requirements on the Jira side:

- The user must already be signed in to the configured Jira site in Chrome.
- Jira time tracking must be enabled.
- The user needs **Browse projects** and **Work on issues** permission for the target issue.

Work Log synchronization performs one-way creation from Toggl to Jira. Later edits or deletions made to an already-synchronized Toggl entry or Jira Work Log are not synchronized bidirectionally.

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
    ├── reads protected local settings and Work Log associations
    ├── starts, reads, and stops Toggl time entries with an optional selected project
    ├── aggregates the current local day and Monday–Sunday week's Toggl time for the popup
    ├── reads Jira summary, description, and time-tracking fields for the active issue
    ├── converts Jira ADF to Markdown only in the trusted popup flow
    ├── queues completed Jira-linked entries when necessary
    └── creates Jira Work Logs on the configured Jira origin
```

The content script tries Jira REST API versions `3`, `2`, and `latest`, then falls back to the visible Jira page for the summary when necessary. Work Log requests prefer REST v3 and fall back to compatible v2 or `latest` endpoints when the Jira deployment does not expose v3.

## Permissions and privacy

### Required permissions

- `storage` — saves the token, workspace and optional project configuration, preferences, Jira-linked timer associations, and pending Work Log retry records in the current Chrome profile.
- `scripting` — dynamically registers `content.js` for the configured Jira site.
- `https://api.track.toggl.com/*` — calls the Toggl Track API.

### Optional Jira host permission

The manifest allows the settings page to request an HTTPS host at runtime. Chrome displays the exact Jira site being requested. The extension stores only the configured origin and registers its content script only for that origin. The same approved origin is used to read issue fields for timer descriptions and popup progress/copy features and, when enabled, create Jira Work Logs.

### Token handling

The Toggl API token is stored in `chrome.storage.local`. The service worker calls:

```javascript
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
```

This prevents the Jira content script from directly reading extension storage. The token is never returned to the Jira page and is never sent to Jira.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for more details.

## Development

No package installation is required. Run:

```bash
npm run validate
```

This command checks JavaScript syntax, validates `manifest.json`, and runs mocked service-worker, popup, and UI contract tests, including optional and automatic project selection, local-day and Monday–Sunday totals, running-entry semantics, toolbar icon states, Jira progress, ADF-to-Markdown conversion, clipboard states, Work Log creation, retries, duplicate prevention, external-stop reconciliation, and icon dimensions.

## Project structure

```text
manifest.json       Manifest V3 configuration and permissions
background.js       Toggl integration, Jira Work Logs, settings, retry state, and security
content.js          Jira issue detection, metadata lookup, and floating button
options.*           Setup page, Work Log preferences, and advanced options
popup.*             Daily/weekly totals, current/manual timers, Jira progress/copy, stop, and Work Log retry UI
icons/              Default and running extension icons in 16, 32, 48, and 128 px sizes
tests/              Mocked service-worker and UI contract tests
PRIVACY.md          Data-handling disclosure
SECURITY.md         Security design and reporting guidance
CONTRIBUTING.md     Contribution workflow
CHANGELOG.md        Release notes
LICENSE             MIT license
```

## APIs used

- Chrome Extensions Manifest V3
- Jira:
  - `GET /rest/api/{version}/issue/{issueKey}?fields=...` for summary, description, and time tracking
  - `GET /rest/api/{version}/issue/{issueKey}/worklog`
  - `POST /rest/api/{version}/issue/{issueKey}/worklog`
  - Jira Work Log properties for Toggl-entry duplicate detection
- Toggl Track API v9:
  - `GET /api/v9/me?with_related_data=true`
  - `GET /api/v9/workspaces/{workspace_id}`
  - `GET /api/v9/workspaces/{workspace_id}/projects/{project_id}`
  - `GET /api/v9/me/time_entries/current`
  - `GET /api/v9/me/time_entries?start_date=...&end_date=...`
  - `GET /api/v9/me/time_entries/{time_entry_id}`
  - `POST /api/v9/workspaces/{workspace_id}/time_entries`
  - `PATCH /api/v9/workspaces/{workspace_id}/time_entries/{time_entry_id}/stop`

Official references:

- https://developer.chrome.com/docs/extensions/reference/api/permissions
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklog-properties/
- https://engineering.toggl.com/docs/track/authentication/
- https://engineering.toggl.com/docs/track/api/time_entries/

## Compatibility

- Chrome 102 or newer.
- Jira sites served over HTTPS.
- Jira Cloud is the primary target. Jira deployments exposing compatible REST v2 or `latest` issue and Work Log endpoints may also work.
- Toggl Track API tokens.

## Publishing and releases

- [RELEASING.md](RELEASING.md) describes versioning, tags, and automated GitHub releases.
- [STORE_LISTING.md](STORE_LISTING.md) contains the Chrome Web Store description, permission justifications, and privacy declarations.
- A tag such as `v0.6.0` triggers the release workflow, which validates the source, creates a minimal Chrome Web Store ZIP plus its SHA-256 checksum, and prepends the matching changelog section to the generated comparison notes.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

MIT — see [LICENSE](LICENSE).
