# Security

## Design

- The Toggl API token is handled only by trusted extension pages and the Manifest V3 service worker.
- **Connect Toggl** requests the exact optional `https://accounts.toggl.com/*` and `https://track.toggl.com/*` origins from a user click, and the worker independently verifies both grants before making fixed-destination session requests.
- The worker includes browser credentials only for `GET https://accounts.toggl.com/api/sessions` and `GET https://track.toggl.com/api/v9/me`; it does not request cookie access, read HttpOnly cookies, accept a caller-provided URL, submit login credentials, or log the user out.
- The Accounts response must be exactly successful before the worker loads the signed-in Track web profile. Its API token is validated through `GET https://api.track.toggl.com/api/v9/me` and saved only after protected-storage setup succeeds. Neither web response is returned to the settings page, settings messages cannot provide or replace the token, and failed validation leaves the previous connection unchanged.
- Legacy saved tokens are validated once to resolve their Toggl user before reconnecting. Reconnecting as a different user is blocked while the old account has a running timer or account-bound Jira/Toggl association or retry state remains. The same user keeps a custom workspace and project selection, and **Remove settings** remains the explicit destructive path.
- Missing sessions open only the fixed Accounts login or Track timer URL for an explicit user retry. Malformed responses fail closed because both cookie-authenticated web endpoints are undocumented integration contracts.
- Messages from Jira are accepted only when their sender origin exactly matches the configured Jira origin.
- Manual timer creation, side-panel insights, appointment replay, and pending Work Log synchronization are available only to trusted extension pages, not to the Jira page.
- Jira UI settings and clipboard preparation are available only to the installed content script when its sender origin exactly matches the configured Jira site.
- The Jira page cannot choose arbitrary network destinations for the service worker.
- All Toggl and Jira API paths are constructed by extension code.
- Jira requests are constrained to the single HTTPS origin approved by the user.
- An explicitly entered Toggl project ID must be a positive integer and is verified through the workspace-scoped Toggl API before settings are accepted.
- Automatic project selection considers only active related projects in the selected workspace and chooses the highest `actual_hours`; timers omit `project_id` when no eligible project exists.
- Jira issue values, manual descriptions, Work Log comments, IDs, and durations are normalized, length-limited, or validated before use. Appointment replay accepts only a positive source time-entry ID, fetches that entry from Toggl, and confirms it overlaps the current local day before stopping anything.
- The floating-button position is restricted to top-left, top-right, bottom-left, or bottom-right before it can affect content-script styles.
- Unknown timer-description and Work Log-comment variables are rejected when settings are saved.
- Side-panel Jira insight lookup uses the existing protected association first and only then applies a conservative Jira-key pattern to the current Toggl description.
- Side-panel appointment links are built only from the validated HTTPS Jira origin and a strict Jira issue key, open in a separate tab with opener access disabled, and are omitted for normal or invalid appointments.
- Jira progress values are returned only to the trusted side panel. The authorized Jira content script receives only the locally formatted clipboard document for its selected issue, never protected settings or the Toggl token.
- The ADF-to-Markdown converter is local, processes unknown nodes through child content, and does not execute Jira HTML or remote code.
- Clipboard writing occurs immediately from the explicit copy click on the configured HTTPS Jira page through `navigator.clipboard.writeText()`; no broad clipboard permission is requested.
- The raw Toggl entries used for **Worked today**, **Worked this week**, and **Today's appointments** are aggregated in the service worker and are neither persisted nor returned to untrusted contexts. The side panel receives only minimal group data required to render and replay a row.
- Work Log synchronization uses a bounded locally stored Toggl-entry association and a Jira Work Log property to reduce duplicate submissions, and asks Jira to adjust the remaining estimate automatically. Only known associations are carried onto replayed entries; Jira-looking manual text is not promoted to an association.
- Failed Work Log requests are retained locally for explicit retry instead of being sent to another service.
- Time-total, Jira-progress, and clipboard failures are isolated from the primary timer controls, so an existing timer remains stoppable.
- The Toggl token is never included in Jira requests, Work Log comments, Work Log properties, or clipboard content.
- The extension contains no remote JavaScript, `eval`, `new Function`, analytics SDK, third-party runtime dependency, or backend integration.
- Toggl Accounts and Track access are requested together for their exact HTTPS origins; Jira access is optional and requested separately for its exact configured origin.
- The required `sidePanel` permission is used only to host the persistent extension UI; the manifest requires Chrome 114 or newer, where that API is available.

## Local profile access

Anyone with access to the same browser profile and its developer tools may be able to inspect extension storage. Treat the Toggl API token like a password and revoke it from Toggl if the browser profile is compromised.

The `TRUSTED_CONTEXTS` storage access level prevents the Jira content script from reading local extension storage, but it is access isolation rather than encryption. Browser or enterprise third-party-cookie restrictions may also prevent Chrome from attaching Toggl session cookies during connection.

Jira association and pending Work Log records can contain issue keys, rendered timer descriptions, timestamps, durations, Toggl entry IDs, errors, and resulting Work Log IDs. Completed associations are retained only within the bounded history used for safe replay and duplicate prevention. Use **Remove settings**, clear extension data, or uninstall the extension to remove this local state. Daily Toggl entry lists, calculated appointment groups, Jira descriptions prepared for copy, and generated clipboard documents are not saved by the extension.

## Jira session and permissions

Jira issue insights, clipboard preparation, and Work Log synchronization rely on the Jira session already active in Chrome. The Jira server remains responsible for authentication, issue-level security, field visibility, time-tracking configuration, and the **Browse projects** and **Work on issues** permissions. A failed Jira request does not prevent the Toggl timer from being stopped.

Project selection is optional. A manually entered project is validated, an eligible project may be selected automatically from related Toggl data, and timers remain usable without a project when none is available.

## Reporting a vulnerability

Do not publish active credentials, browser-session data, clipboard content, or sensitive Jira content in a public issue. Share a minimal reproduction that contains no secrets, then rotate any credential that may have been exposed.
