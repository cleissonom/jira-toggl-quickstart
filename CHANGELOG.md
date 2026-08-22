# Changelog

## Unreleased

## 0.7.2 — 2026-08-22

- Replaced the full-width bottom Settings button with an accessible settings gear in the side-panel title header.
- Made Jira appointment names recognized from retained associations or valid issue keys in their descriptions open the exact configured Jira issue in a new tab, with underlined text and blue hover and keyboard-focus feedback; description inference remains navigation-only.

## 0.7.1 — 2026-08-22

- Replaced manual Toggl API-token entry with **Connect Toggl**, which requests exact optional Toggl Accounts and Track access, confirms the existing account session, retrieves the token from the signed-in Track web profile, validates it through the public API, and stores it only in protected local extension storage.
- Added explicit login-and-retry handling for both web sessions, fail-closed response validation, atomic reconnect behavior, cross-account Work Log protection, token-injection protection for settings messages, and removal of both Toggl grants with extension settings.

## 0.7.0 — 2026-08-22

- Replaced the toolbar popup with a persistent Chrome side panel that opens from the extension action and adapts to the browser-managed width and scrolling surface.
- Added a live **Today's appointments** list that aggregates named Toggl entries for the local day and replays them from the side panel.
- Made replay stop any current timer through the existing Jira Work Log flow, preserve known Jira linkage on the new entry, and keep Jira-looking manual entries Toggl-only.
- Retained a bounded history of completed Jira timer associations so sync-disabled Jira work can be recognized safely when replayed.
- Moved **Copy Jira title & description** beside the floating Jira timer button, fixed the user-gesture copy flow, and added accessible busy/success animation without adding clipboard permission.
- Added top-left, top-right, bottom-left, and bottom-right placement options for the Jira timer and copy controls.
- Raised the minimum supported Chrome version to 114 and added the required `sidePanel` permission.
- Updated release metadata, automated coverage, privacy and security disclosures, store copy, and maintainer documentation for v0.7.0.

## 0.6.0 — 2026-08-21

- Added a Monday–Sunday **Worked this week** total beside **Worked today**, using one Toggl request and local live updates for a running timer.
- Added automatic toolbar icon switching when a Toggl timer starts, stops, or is restored after browser startup.
- Rounded both toolbar icon states and added a high-contrast black, cyan, and near-white running-state palette with a play symbol.
- Rounded the popup's bottom-left and bottom-right corners by 16 px.
- Updated GitHub Releases to prepend the matching changelog section before the generated comparison notes.

## 0.5.1 — 2026-08-20

- Made the Toggl project ID optional again and added automatic selection from the related project data returned by Toggl.
- When the project field is blank, selects the active project in the chosen workspace with the highest `actual_hours`; timers remain projectless when no active project is available.
- Removed exact-second Jira Work Log durations and migrated the legacy exact setting to nearest-minute rounding.
- Fixed Jira progress so the displayed time left is calculated from original estimate minus logged time.
- Changed synchronized Work Logs to let Jira automatically reduce the remaining estimate, matching Jira's normal Work Log behavior.
- Updated settings text, migration behavior, tests, and release metadata for version 0.5.1.

## 0.5.0 — 2026-08-20

- Made the Toggl project ID required, moved it into Quick Setup, and added API validation that the project exists in the selected workspace.
- Blocked Jira and manual timer creation until a valid project is configured, and included `project_id` on every new Toggl entry.
- Added upgrade handling that directs v0.4.0 users without a project to Settings while keeping existing running timers readable and stoppable.
- Added a browser-local **Worked today** total covering completed and running entries across all Toggl projects and workspaces.
- Added local live advancement of the daily total while the popup remains open, without repeated API polling.
- Added Jira logged-time progress against original and remaining estimates for the current Jira-linked timer, including over-estimate states.
- Added association-first Jira issue detection with a conservative description-key fallback and REST v3, v2, and `latest` compatibility.
- Added an explicit **Copy Jira title & description** action and a local Atlassian Document Format-to-Markdown converter.
- Added safe support for common ADF blocks, lists, task items, text marks, links, code, mentions, emoji, tables, unknown nodes, and dynamic backtick fences.
- Preserved timer start/stop and Jira Work Log controls when secondary daily-total, Jira-progress, or clipboard operations fail.
- Updated privacy, security, store-listing, release, and usage documentation for the new data flows.
- Expanded automated coverage to 83 tests for required-project behavior, local-day totals, Jira progress, ADF conversion, clipboard feedback, and all existing Work Log behavior.

## 0.4.0 — 2026-08-19

- Added optional one-way synchronization from Jira-linked Toggl timers to Jira Work Logs.
- Added Automatic and Ask before syncing modes.
- Added exact, nearest-minute, and round-up Work Log duration handling.
- Added a configurable Work Log comment template with `{description}`, `{issueKey}`, and `{togglId}` variables.
- Added a protected local association and retry queue for Jira-linked Toggl entries.
- Added popup controls for confirming and retrying pending Work Logs.
- Added reconciliation for Jira-linked timers stopped outside the extension when the popup is opened.
- Added Jira Work Log properties and lookup-based duplicate prevention.
- Kept Jira remaining estimates unchanged when creating Work Logs.
- Replaced all 16, 32, 48, and 128 px extension icons with the new task-to-timer artwork.
- Expanded automated coverage for Work Log creation, retries, duplicate prevention, rounding, reconciliation, UI contracts, and icon dimensions.

## 0.3.0 — 2026-08-19

- Added a manual timer form to the toolbar popup when no timer is running.
- Added a direct link from Settings to the Toggl Track API Token page.
- Expanded Jira description templates from two to fourteen variables.
- Added click-to-insert variable controls and a live template preview.
- Added Jira metadata lookup for project, issue type, status, people, priority, parent, labels, and components.
- Reused the saved Billable, workspace, project, and timer-switching defaults for manual timers.
- Added validation for unknown template variables and manual descriptions.
- Expanded the automated suite to cover service-worker behavior, UI contracts, dynamic Jira permissions, and manual timers.

## 0.2.0

- Added a configurable Jira site URL with exact runtime host permission.
- Added a Billable setting and sends the selected value on new Toggl time entries.
- Moved technical options into a collapsed Advanced settings section.
- Added default-workspace detection and optional fixed-project validation.
- Translated the entire extension, source comments, tests, and documentation to English.
- Added open-source contribution, privacy, and security documentation.
- Added Jira REST v3, v2, and `latest` summary lookup fallbacks.

## 0.1.0

- Initial one-click Jira-to-Toggl timer workflow for a single hard-coded Jira site.
