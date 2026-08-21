# Security

## Design

- The Toggl API token is handled only by trusted extension pages and the Manifest V3 service worker.
- Messages from Jira are accepted only when their sender origin exactly matches the configured Jira origin.
- Manual timer creation, popup insights, clipboard preparation, and pending Work Log synchronization are available only to trusted extension pages, not to the Jira page.
- The Jira page cannot choose arbitrary network destinations for the service worker.
- All Toggl and Jira API paths are constructed by extension code.
- Jira requests are constrained to the single HTTPS origin approved by the user.
- An explicitly entered Toggl project ID must be a positive integer and is verified through the workspace-scoped Toggl API before settings are accepted.
- Automatic project selection considers only active related projects in the selected workspace and chooses the highest `actual_hours`; timers omit `project_id` when no eligible project exists.
- Jira issue values, manual descriptions, Work Log comments, IDs, and durations are normalized, length-limited, or validated before use.
- Unknown timer-description and Work Log-comment variables are rejected when settings are saved.
- Popup Jira insight lookup uses the existing protected association first and only then applies a conservative Jira-key pattern to the current Toggl description.
- Jira summary, description, and time-tracking values are returned only to the trusted popup and are not exposed to Jira content scripts or unrelated pages.
- The ADF-to-Markdown converter is local, processes unknown nodes through child content, and does not execute Jira HTML or remote code.
- Clipboard writing occurs only from the explicit popup button click through `navigator.clipboard.writeText()`; no broad clipboard permission is requested.
- The raw Toggl entries used for **Worked today** and **Worked this week** are aggregated in the service worker and are neither persisted nor returned to untrusted contexts.
- Work Log synchronization uses a locally stored Toggl-entry association and a Jira Work Log property to reduce duplicate submissions, and asks Jira to adjust the remaining estimate automatically.
- Failed Work Log requests are retained locally for explicit retry instead of being sent to another service.
- Time-total, Jira-progress, and clipboard failures are isolated from the primary timer controls, so an existing timer remains stoppable.
- The Toggl token is never included in Jira requests, Work Log comments, Work Log properties, or clipboard content.
- The extension contains no remote JavaScript, `eval`, `new Function`, analytics SDK, third-party runtime dependency, or backend integration.
- Jira host access is optional and requested for one exact HTTPS origin at setup time.

## Local profile access

Anyone with access to the same browser profile and its developer tools may be able to inspect extension storage. Treat the Toggl API token like a password and revoke it from Toggl if the browser profile is compromised.

Pending Work Log records can contain Jira issue keys, rendered timer descriptions, timestamps, durations, and Toggl entry IDs. Use **Remove settings**, clear extension data, or uninstall the extension to remove this local state. Daily Toggl entry lists, Jira descriptions loaded for the popup, and generated clipboard documents are not saved by the extension.

## Jira session and permissions

Jira issue insights and Work Log synchronization rely on the Jira session already active in Chrome. The Jira server remains responsible for authentication, issue-level security, field visibility, time-tracking configuration, and the **Browse projects** and **Work on issues** permissions. A failed Jira request does not prevent the Toggl timer from being stopped.

Project selection is optional. A manually entered project is validated, an eligible project may be selected automatically from related Toggl data, and timers remain usable without a project when none is available.

## Reporting a vulnerability

Do not publish active credentials, browser-session data, clipboard content, or sensitive Jira content in a public issue. Share a minimal reproduction that contains no secrets, then rotate any credential that may have been exposed.
