# Privacy

Jira → Toggl Quick Start does not operate a backend, collect analytics, show advertising, sell data, or send user data to the extension developer.

## Data stored locally

The extension stores the following values in `chrome.storage.local`:

- Toggl Track API token.
- Configured Jira origin.
- Toggl account identifier and display name or email, workspace identifier and display name, plus an optional selected project identifier and display name.
- Billable preference.
- Description template, automatic timer-switching preference, and floating button position.
- Optional Jira Work Log settings, including synchronization mode, rounding, and comment template.
- A bounded set of associations between Jira-linked Toggl time-entry IDs and Jira issue keys while entries are running, pending, completed for replay, or retained for duplicate prevention.
- Pending Work Log retry information, including issue key, rendered description, start and stop timestamps, duration, Jira origin, retry error, and resulting Jira Work Log ID when available.

These values remain in the current Chrome profile unless the user removes them, clears extension data, or uninstalls the extension. Selecting **Remove settings** also removes the Work Log association and retry state. The first reconnect from a legacy saved token validates that token to identify its user. If its identity cannot be verified, its timer is still running, or Jira-linked timer/Work Log history is retained for a different user, the extension blocks replacement instead of silently orphaning, deleting, or mixing state; **Remove settings** is the explicit destructive path.

The extension does not persist the Toggl Accounts session response, complete Track web-profile response, browser cookies, list of Toggl entries retrieved for **Worked today**, **Worked this week**, or **Today's appointments**, the calculated totals, Jira descriptions prepared for copying, or clipboard documents. Account and Jira metadata are held only in transient service-worker or content-script memory unless explicitly listed above. Manual timer descriptions are not persisted by the extension. A rendered description may be retained in bounded Jira association state only when it belongs to a timer started from Jira or replayed from a known Jira association.

## Network requests

The extension sends requests only to:

- The configured Jira origin, through the browser's existing authenticated Jira session.
- `https://accounts.toggl.com`, only after the user clicks **Connect Toggl**, through the browser's existing Toggl account session.
- `https://track.toggl.com`, only after the user clicks **Connect Toggl**, through the browser's existing Toggl Track web session.
- `https://api.track.toggl.com`, authenticated with the user's Toggl API token.

### Toggl account connection

After the user grants the exact optional `https://accounts.toggl.com/*` and `https://track.toggl.com/*` permissions, the service worker sends `GET https://accounts.toggl.com/api/sessions` with browser credentials included. A successful response confirms the session with `{ "success": true }`; it does not contain the API token. The worker then sends credentialed `GET https://track.toggl.com/api/v9/me`, extracts the API token from that signed-in Track web profile, and validates it with `GET https://api.track.toggl.com/api/v9/me` before storing it. Chrome may attach Toggl's secure session cookies; the extension does not read, copy, or store those cookies itself. Neither web response nor the API token is returned to the settings page.

If the Accounts session is missing, the extension opens `https://accounts.toggl.com/track/login/`. If the Track web profile is unavailable, it opens `https://track.toggl.com/timer`. In both cases it waits for the user to retry explicitly; it does not submit login credentials, poll the account, or log the user out. The session check and cookie-authenticated Track web-profile request are web-app behavior, not documented stable public integration contracts; sequencing them for extension connection is an inference from Toggl's current official bundle. An unsupported response fails without changing the saved token. Browser or enterprise third-party-cookie restrictions may prevent this flow.

### Toggl requests

Toggl requests are used to:

- validate the API token;
- detect or validate the selected workspace;
- read related project metadata, including active status and `actual_hours`, to choose an optional project when the field is blank;
- validate an explicitly entered project against the selected workspace;
- read the current running entry;
- read the current user's entries from the browser-local Sunday preceding the current week through now for **Worked today**, **Worked this week**, and per-appointment local-day totals, allowing Sunday entries that cross into Monday to be clipped correctly;
- validate a user-selected source time-entry ID before replaying today's appointment;
- create new entries with `project_id` when a project is selected, or without it when no active project is available; and
- stop or reconcile entries.

The weekly request may return entries from multiple Toggl projects or workspaces because the side-panel totals represent all work by the current user during the local day and Monday–Sunday week. The service worker calculates daily, weekly, and per-appointment aggregates locally. It returns only each named group's source ID, known Jira issue key when one was retained, normalized description, clipped duration, and running ID to the trusted side panel; it neither stores nor returns the raw response.

Toggl filters this history endpoint by entry start time and returns at most 1,000 entries. Consequently, a stopped timer that began before the Sunday lookback or an unusually high-volume week beyond that response limit may be omitted from these local aggregates.

### Jira requests

Depending on the configured description template, Jira fields read by the content script may include the issue key, summary, project, type, status, assignee, reporter, priority, parent, labels, and components. Only the rendered Toggl description and configured timer fields are sent to Toggl.

When the current Toggl entry can be associated with a Jira issue, the trusted extension service worker may request the issue key, summary, logged time, original estimate, and remaining estimate to show side-panel progress. Separately, when an issue is selected or opened, the authorized Jira content script asks the worker to prepare its summary and description for the adjacent copy action. Jira Cloud Atlassian Document Format is converted to Markdown in the worker, and only the formatted document is returned to that content script. Jira issue content is written to the clipboard only after the user explicitly clicks **Copy Jira title & description**.

Clicking an underlined Jira-linked appointment name opens the configured Jira origin at `/browse/{issueKey}` in a new tab. The link is built locally from the saved HTTPS Jira origin and retained issue association. Normal appointments are not linked, and displaying the link does not add a permission or background request.

When Work Log synchronization is enabled, the extension sends the target issue key in the Jira request URL and sends the timer start time, duration, optional configured comment, and a property containing the Toggl time-entry ID and workspace ID to the configured Jira site. Jira is instructed to adjust the remaining estimate automatically for the new Work Log. Before creating a Work Log, the extension may read existing Work Logs and their properties to reduce duplicate submissions.

No browsing history, Jira issue data, Toggl time entries, manually entered descriptions, tokens, clipboard content, Work Log data, or retry records are sent to the extension author or any separate service.

## Permissions

The extension requires Chrome's `sidePanel` permission to host its persistent controls beside the current tab. It requests runtime access to `https://accounts.toggl.com/*` and `https://track.toggl.com/*` together when the user clicks **Connect Toggl**, and separately requests the exact Jira origin entered when settings are saved. The two Toggl grants are used only for the account-session check and signed-in Track web-profile request. The approved Jira origin is used for the Jira timer and copy actions, issue metadata, side-panel Jira progress, and optional Work Log synchronization. Removing the extension settings also asks Chrome to remove all of these runtime host grants. If Chrome cannot confirm their removal, Settings shows a warning so the user can remove the grants from the extension's site settings.

The extension does not request a broad clipboard permission. Clipboard writing occurs through `navigator.clipboard.writeText()` only from the user's explicit click beside the floating Jira timer button on the configured HTTPS Jira site.

## Token protection

The worker requires `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` to succeed before saving a newly connected token. The Jira content script cannot directly read it. The token is sent only to the Toggl API and is never returned in settings or content-script messages or included in Jira requests, Work Log comments, or clipboard content. This access restriction is not encryption: anyone with access to the Chrome profile and extension developer tools may still be able to inspect local extension storage.

## Purpose and limited use

The extension uses Jira issue data, Toggl account and time-entry data, timer descriptions, and optional Work Log data only for its user-facing purpose: tracking Jira work in Toggl, presenting local work insights, copying Jira details on request, and optionally recording completed Jira-linked time in Jira Work Logs. Data is not used for advertising, profiling, analytics, creditworthiness, or any unrelated purpose.

Jira issue fields are read only when needed to identify the current issue, render the description template, display Jira progress, or prepare the explicit copy action. Manual timers remain Toggl-only for Work Log association purposes, even when their text resembles a Jira key. Replaying a timer with a retained Jira association carries that association to the new entry; otherwise replay remains Toggl-only. The side panel's Jira insight fallback may conservatively recognize a valid issue key in the current description, but it still does not create a Work Log association.

The extension's use and transfer of user data is limited to providing this functionality and follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Deletion and control

Users can disable Work Log synchronization without disabling Toggl timers. Pending records remain visible in the side panel so the user can explicitly retry them. **Remove settings**, clearing extension data, or uninstalling the extension removes the local queue and saved configuration.

Toggl time entries and Jira Work Logs already created belong to the user's accounts and must be managed or deleted in Toggl or Jira. The extension does not automatically propagate later edits or deletions between the two services.
