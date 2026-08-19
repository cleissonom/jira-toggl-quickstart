# Privacy

Jira → Toggl Quick Start does not operate a backend and does not collect analytics.

## Data stored locally

The extension stores the following values in `chrome.storage.local`:

- Toggl Track API token.
- Configured Jira origin.
- Toggl workspace and optional project identifiers and display names.
- Billable preference.
- Description template and automatic timer-switching preference.
- Optional Jira Work Log settings, including synchronization mode, rounding, and comment template.
- Associations between Jira-linked Toggl time-entry IDs and Jira issue keys while the entries are running, pending, or retained for duplicate prevention.
- Pending Work Log retry information, including issue key, rendered description, start and stop timestamps, duration, Jira origin, retry error, and resulting Jira Work Log ID when available.

These values remain in the current Chrome profile unless the user removes them, clears extension data, or uninstalls the extension. Selecting **Remove settings** also removes the Work Log association and retry state.

Jira issue metadata used only to render a timer description remains in the current page's short-lived in-memory cache. Manual timer descriptions are not persisted by the extension. A rendered description may be retained in the local Work Log state only when it belongs to a timer started from the Jira button.

## Network requests

The extension sends requests only to:

- The configured Jira origin, through the browser's existing authenticated Jira session, to retrieve the selected issue fields needed by the description template and, when enabled, to read or create Jira Work Logs.
- `https://api.track.toggl.com`, to validate the token, inspect time entries, and create or stop timers.

Depending on the template, Jira fields may include the issue key, summary, project, type, status, assignee, reporter, priority, parent, labels, and components. Only the rendered Toggl description and configured timer fields are sent to Toggl.

When Work Log synchronization is enabled, the extension sends the target issue key in the Jira request URL and sends the timer start time, duration, optional configured comment, and a property containing the Toggl time-entry ID and workspace ID to the configured Jira site. The Jira remaining estimate is left unchanged. Before creating a Work Log, the extension may read existing Work Logs and their properties to reduce duplicate submissions.

No browsing history, Jira issue data, Toggl time entries, manually entered descriptions, tokens, Work Log data, or retry records are sent to the extension author or any separate service.

## Permissions

The extension requests runtime access to the exact Jira origin entered in Settings. This approved origin is used for the Jira button, issue metadata, and optional Work Log synchronization. Removing the extension settings also removes that host permission.

## Token protection

The Toggl token is available only to trusted extension contexts through `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`. The Jira content script cannot directly read it. The token is sent only to the Toggl API and is never included in Jira requests.

## Purpose and limited use

The extension uses Jira issue data, Toggl account data, timer descriptions, and optional Work Log data only for its single user-facing purpose: tracking Jira work in Toggl and optionally recording completed Jira-linked time in Jira Work Logs. Data is not used for advertising, profiling, analytics, creditworthiness, or any unrelated purpose.

Jira issue fields are read only when needed to identify the current issue and render the description template. Manual timers remain Toggl-only. Work Log synchronization applies only to timers explicitly linked to a Jira issue by the extension; the extension does not infer a Jira issue from arbitrary manual text.

The extension's use and transfer of user data is limited to providing this functionality and follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Deletion and control

Users can disable Work Log synchronization without disabling Toggl timers. Pending records remain visible in the popup so the user can explicitly retry them; **Remove settings**, clearing extension data, or uninstalling the extension removes the local queue and saved configuration.

Toggl time entries and Jira Work Logs already created belong to the user's accounts and must be managed or deleted in Toggl or Jira. Version 0.4 does not automatically propagate later edits or deletions between the two services.
