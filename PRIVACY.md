# Privacy

Jira → Toggl Quick Start does not operate a backend and does not collect analytics.

## Data stored locally

The extension stores the following values in `chrome.storage.local`:

- Toggl Track API token.
- Configured Jira origin.
- Toggl workspace and optional project identifiers and display names.
- Billable preference.
- Description template.
- Automatic timer-switching preference.

These settings remain in the current Chrome profile unless the user removes them, clears extension data, or uninstalls the extension.

Jira issue metadata and manually entered timer descriptions are not persisted by the extension. Jira data is held only in the current page's short-lived in-memory cache while the tab is open.

## Network requests

The extension sends requests only to:

- The configured Jira origin, through the browser's existing authenticated Jira session, to retrieve the selected issue fields needed by the description template.
- `https://api.track.toggl.com`, to validate the token, inspect the current timer, and create or stop time entries.

Depending on the template, Jira fields may include the issue key, summary, project, type, status, assignee, reporter, priority, parent, labels, and components. Only the rendered Toggl description and configured timer fields are sent to Toggl.

No browsing history, Jira issue data, Toggl time entries, manually entered descriptions, or tokens are sent to the extension author or any separate service.

## Permissions

The extension requests runtime access to the exact Jira origin entered in Settings. Removing the extension settings also removes that host permission.

## Token protection

The Toggl token is available only to trusted extension contexts through `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`. The Jira content script cannot directly read it.

## Purpose and limited use

The extension uses Jira issue data, Toggl account data, and manually entered descriptions only to provide its single user-facing purpose: creating, displaying, and stopping Toggl Track timers for the user. Data is not used for advertising, profiling, analytics, creditworthiness, or any unrelated purpose.

Jira issue fields are read only when needed to identify the current issue and render the description template. When the user starts a timer, only the rendered description and selected Toggl timer fields are transferred to Toggl. The extension does not permit the developer or other humans to read this data.

The extension's use and transfer of user data is limited to providing this functionality and follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Deletion and control

Users can remove the saved token, preferences, and Jira host permission from the extension Settings page. Uninstalling the extension also removes its local extension storage from the Chrome profile. Toggl time entries already created belong to the user's Toggl account and must be managed or deleted in Toggl.

