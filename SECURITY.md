# Security

## Design

- The Toggl API token is handled only by trusted extension pages and the Manifest V3 service worker.
- Messages from Jira are accepted only when their sender origin exactly matches the configured Jira origin.
- Manual timer creation and pending Work Log synchronization are accepted only from trusted extension pages, not from the Jira page.
- The Jira page cannot choose arbitrary network destinations for the service worker.
- All Toggl and Jira API paths are constructed by extension code.
- Jira requests are constrained to the single HTTPS origin approved by the user.
- Jira issue values, manual descriptions, Work Log comments, IDs, and durations are normalized, length-limited, or validated before use.
- Unknown timer-description and Work Log-comment variables are rejected when settings are saved.
- Work Log synchronization uses a locally stored Toggl-entry association and a Jira Work Log property to reduce duplicate submissions.
- Failed Work Log requests are retained locally for explicit retry instead of being sent to another service.
- The Toggl token is never included in Jira requests, Work Log comments, or Work Log properties.
- The extension contains no remote JavaScript, `eval`, analytics SDK, or backend integration.
- Jira host access is optional and requested for one exact HTTPS origin at setup time.

## Local profile access

Anyone with access to the same browser profile and its developer tools may be able to inspect extension storage. Treat the Toggl API token like a password and revoke it from Toggl if the browser profile is compromised.

Pending Work Log records can contain Jira issue keys, rendered timer descriptions, timestamps, durations, and Toggl entry IDs. Use **Remove settings**, clear extension data, or uninstall the extension to remove this local state.

## Jira session and permissions

Work Log synchronization relies on the Jira session already active in Chrome. The Jira server remains responsible for authentication, issue-level security, time-tracking configuration, and the **Browse projects** and **Work on issues** permissions. A failed Jira request remains pending and does not prevent the Toggl timer from stopping.

## Reporting a vulnerability

Do not publish active credentials, browser-session data, or sensitive Jira content in a public issue. Share a minimal reproduction that contains no secrets, then rotate any credential that may have been exposed.
