# Security

## Design

- The Toggl API token is handled only by trusted extension pages and the Manifest V3 service worker.
- Messages from Jira are accepted only when their sender origin exactly matches the configured Jira origin.
- Manual timer creation is accepted only from trusted extension pages, not from the Jira page.
- The Jira page cannot choose arbitrary network destinations for the service worker.
- All Toggl API paths are constructed by extension code.
- Jira issue values and manual descriptions are normalized, length-limited, and validated before use.
- Unknown description-template variables are rejected when settings are saved.
- The extension contains no remote JavaScript, `eval`, analytics SDK, or backend integration.
- Jira host access is optional and requested for one exact HTTPS origin at setup time.

## Local profile access

Anyone with access to the same browser profile and its developer tools may be able to inspect extension storage. Treat the Toggl API token like a password and revoke it from Toggl if the browser profile is compromised.

## Reporting a vulnerability

Do not publish active credentials or sensitive Jira data in a public issue. Share a minimal reproduction that contains no secrets, then rotate any credential that may have been exposed.
