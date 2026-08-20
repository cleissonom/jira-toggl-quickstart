# Privacy

Jira → Toggl Quick Start does not operate a backend, collect analytics, show advertising, sell data, or send user data to the extension developer.

## Data stored locally

The extension stores the following values in `chrome.storage.local`:

- Toggl Track API token.
- Configured Jira origin.
- Toggl workspace identifier and display name, plus an optional selected project identifier and display name.
- Billable preference.
- Description template and automatic timer-switching preference.
- Optional Jira Work Log settings, including synchronization mode, rounding, and comment template.
- Associations between Jira-linked Toggl time-entry IDs and Jira issue keys while the entries are running, pending, or retained for duplicate prevention.
- Pending Work Log retry information, including issue key, rendered description, start and stop timestamps, duration, Jira origin, retry error, and resulting Jira Work Log ID when available.

These values remain in the current Chrome profile unless the user removes them, clears extension data, or uninstalls the extension. Selecting **Remove settings** also removes the Work Log association and retry state.

The extension does not persist the list of Toggl entries retrieved for **Worked today**, the calculated daily total, Jira issue descriptions loaded for the popup, or clipboard documents. Jira metadata used by the content script to render a timer description remains only in the Jira page's short-lived in-memory cache. Manual timer descriptions are not persisted by the extension. A rendered description may be retained in local Work Log state only when it belongs to a timer started from the Jira button.

## Network requests

The extension sends requests only to:

- The configured Jira origin, through the browser's existing authenticated Jira session.
- `https://api.track.toggl.com`, authenticated with the user's Toggl API token.

### Toggl requests

Toggl requests are used to:

- validate the API token;
- detect or validate the selected workspace;
- read related project metadata, including active status and `actual_hours`, to choose an optional project when the field is blank;
- validate an explicitly entered project against the selected workspace;
- read the current running entry;
- read the current user's entries from browser-local midnight through the current time for **Worked today**;
- create new entries with `project_id` when a project is selected, or without it when no active project is available; and
- stop or reconcile entries.

The daily request may return entries from multiple Toggl projects or workspaces because the popup total represents all work by the current user during the local day. The service worker calculates the total locally and returns only the aggregate and minimal running-entry metadata to the popup; it does not store or disclose the raw daily response.

### Jira requests

Depending on the configured description template, Jira fields read by the content script may include the issue key, summary, project, type, status, assignee, reporter, priority, parent, labels, and components. Only the rendered Toggl description and configured timer fields are sent to Toggl.

When the current Toggl entry can be associated with a Jira issue, the trusted extension service worker may also request the issue key, summary, description, logged time, original estimate, and remaining estimate from the configured Jira origin. These values are used only to show Jira progress and prepare the copy action in the extension popup. Jira Cloud descriptions returned as Atlassian Document Format are converted to Markdown locally. Jira issue content is written to the clipboard only after the user explicitly clicks **Copy Jira title & description**.

When Work Log synchronization is enabled, the extension sends the target issue key in the Jira request URL and sends the timer start time, duration, optional configured comment, and a property containing the Toggl time-entry ID and workspace ID to the configured Jira site. Jira is instructed to adjust the remaining estimate automatically for the new Work Log. Before creating a Work Log, the extension may read existing Work Logs and their properties to reduce duplicate submissions.

No browsing history, Jira issue data, Toggl time entries, manually entered descriptions, tokens, clipboard content, Work Log data, or retry records are sent to the extension author or any separate service.

## Permissions

The extension requests runtime access to the exact Jira origin entered in Settings. This approved origin is used for the Jira button, issue metadata, popup Jira progress and copy features, and optional Work Log synchronization. Removing the extension settings also removes that host permission.

The extension does not request a broad clipboard permission. Clipboard writing occurs through `navigator.clipboard.writeText()` only from the user's explicit popup button click.

## Token protection

The Toggl token is available only to trusted extension contexts through `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`. The Jira content script cannot directly read it. The token is sent only to the Toggl API and is never included in Jira requests, popup messages to Jira pages, Work Log comments, or clipboard content.

## Purpose and limited use

The extension uses Jira issue data, Toggl account and time-entry data, timer descriptions, and optional Work Log data only for its user-facing purpose: tracking Jira work in Toggl, presenting local work insights, copying Jira details on request, and optionally recording completed Jira-linked time in Jira Work Logs. Data is not used for advertising, profiling, analytics, creditworthiness, or any unrelated purpose.

Jira issue fields are read only when needed to identify the current issue, render the description template, display Jira progress, or fulfill the explicit copy action. Manual timers remain Toggl-only for Work Log association purposes. Work Log synchronization applies only to timers explicitly linked to a Jira issue by the extension; the popup's Jira insight fallback may conservatively recognize a valid issue key in the current Toggl description, but this does not create a Work Log association.

The extension's use and transfer of user data is limited to providing this functionality and follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Deletion and control

Users can disable Work Log synchronization without disabling Toggl timers. Pending records remain visible in the popup so the user can explicitly retry them. **Remove settings**, clearing extension data, or uninstalling the extension removes the local queue and saved configuration.

Toggl time entries and Jira Work Logs already created belong to the user's accounts and must be managed or deleted in Toggl or Jira. Version 0.5.1 does not automatically propagate later edits or deletions between the two services.
