# Changelog

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
