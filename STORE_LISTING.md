# Chrome Web Store listing notes

This file is a maintainer checklist and source for the Chrome Web Store Developer Dashboard. Review every statement against the submitted version before publishing.

## Suggested short description

Start and replay Toggl timers with today's totals, flexible Jira controls, Markdown copy, and optional Work Log sync.

## Suggested detailed description

Jira → Toggl Quick Start turns the Jira issue you are viewing into a correctly formatted Toggl Track timer. The default description is `[{key}] {summary}`, and the format can be customized with Jira variables such as project, issue type, status, assignee, priority, labels, and components.

The Toggl project is optional. During setup, an entered project ID is validated against the selected or default workspace. When the field is blank, the extension selects the active project in that workspace with the highest `actual_hours`; if no active project is available, timers are created without a project.

Clicking the toolbar icon opens a persistent Chrome side panel. It shows **Worked today** for the browser-local day and **Worked this week** for the current Monday–Sunday week, including returned completed entries and the live portion of the running entry across Toggl projects and workspaces. **Today's appointments** groups known Jira sessions by issue and other named sessions by description, shows each local-day total, and provides **Play**. A Jira-linked appointment name can open its exact Jira issue in a new tab; normal appointment names remain plain text. Play validates the source, stops any different current timer, and starts the selected description with the saved defaults. Settings are available from the gear in the title header. The browser manages the panel width and vertical scrolling, and the rounded toolbar icon switches to a high-contrast black, cyan, and white running state while an active timer is known.

When the running entry is associated with a Jira issue, the side panel shows Jira's logged time against the original estimate, including remaining or over-estimate time. **Copy Jira title & description** now appears beside the floating Jira timer button whenever an issue is selected or opened. It copies the Jira key, summary, and locally Markdown-converted description only after an explicit click, with animated busy and success feedback. The timer and copy actions can be placed in the top-left, top-right, bottom-left, or bottom-right corner.

Optional Jira Work Log synchronization can create a Work Log when a Jira-linked timer stops. Play routes a stopped current timer through the same automatic or confirmation flow before the selected appointment starts. Replaying a timer with a retained Jira association links the new entry to that issue; manual entries remain Toggl-only even when their descriptions look like Jira keys. Failed requests remain in a local retry queue, and a Jira Work Log property is used to reduce duplicate submissions. Jira automatically reduces the remaining estimate when the Work Log is created.

The extension also provides a manual timer field in the side panel, supports billable and non-billable defaults, and can stop the current timer automatically when switching work. Manual timers remain Toggl-only and are not matched to Jira issues for Work Log creation.

Setup is intentionally small: click **Connect Toggl** to use the account already signed in to Chrome, enter a Jira site URL, optionally enter a Toggl project ID, choose the defaults, and save. Advanced settings include the four floating-control positions. A blank project field is populated automatically when an eligible related project exists. Toggl Accounts and Track access are requested together for their exact origins; Jira access is requested separately for its exact origin.

This is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Atlassian or Toggl.

## Single purpose

Track and replay Jira and related manual work in Toggl, present local Toggl/Jira work insights, copy selected Jira issue content on explicit request, and optionally record completed Jira-linked timers in Jira Work Logs.

## Permission justifications

- `storage`: stores the Toggl API token, workspace and optional project configuration, floating-control position, user-selected settings, bounded Jira-linked timer associations, and pending Work Log retry records in the local Chrome profile.
- `scripting`: dynamically registers the Jira content script only for the origin approved by the user.
- `sidePanel`: hosts the persistent extension controls beside the current tab and allows the toolbar icon to toggle them. The extension requires Chrome 114 or newer.
- `https://api.track.toggl.com/*`: validates the Toggl account and workspace; reads related projects for optional automatic selection; reads current and week-boundary time entries; validates a selected replay source; and creates or stops time entries.
- Optional `https://*/*`: allows the user to approve exact HTTPS origins at runtime. **Connect Toggl** requests only `https://accounts.toggl.com/*` to confirm the existing Accounts session and `https://track.toggl.com/*` to load the signed-in Track profile. Saving settings separately requests one exact Jira origin, including Jira Cloud, custom Jira domains, and compatible self-hosted deployments. The Jira grant is used to read issue information, render the Jira timer/copy actions, show Jira progress, prepare user-requested Markdown copy, and optionally create Work Logs. No unrelated origin is accessed unless the user explicitly configures and approves it.

No clipboard permission is requested. The configured HTTPS Jira page writes to the clipboard only when the user clicks **Copy Jira title & description** beside the floating timer button.

## Privacy-practice declarations

The extension handles the following data only to provide its stated functionality:

- Authentication information: existing Toggl Accounts and Track web sessions used once per connection attempt, plus a Toggl API token stored locally and sent only to the Toggl API over HTTPS. The extension never reads or stores the session cookies, and neither web response nor the token is returned to the settings page.
- Personally identifiable information: the Toggl profile response may contain the user's display name or email and is used only to confirm the connected account in Settings.
- Website content: selected Jira issue fields, including summary, description, and time-tracking values; existing Work Log properties used for duplicate prevention; and the Work Log response from the configured Jira site.
- User-generated content: the rendered Jira timer description, a manually typed Toggl timer description, Jira content copied after an explicit click, and the optional Work Log comment configured by the user.
- Account and workspace metadata: the Toggl user identifier used to keep account-bound state separated, profile, workspace, optional project metadata including active status and `actual_hours`, current timer, selected replay source, and week-boundary time-entry information used to configure, operate, and display the integration.

The service worker calculates daily, weekly, per-appointment, and Jira progress values locally. Raw time-entry lists are not stored or exposed to unrelated pages; the trusted side panel receives only minimal grouped row data. Jira issue content is copied only after the user explicitly clicks the adjacent copy button. When Work Log synchronization is enabled, the extension sends the issue key, timer start time, duration, optional comment, and Toggl identifiers to the configured Jira site.

The extension has no backend, advertising, analytics, data sale, or developer-operated data collection. It does not send data to the extension author.

Use the public `PRIVACY.md` URL in the Developer Dashboard after the repository is published.

## Reviewer test instructions

1. Use a Jira site where the reviewer is signed in and has **Browse projects** permission; **Work on issues** is also required to test Work Log creation.
2. Sign in at `https://accounts.toggl.com/track/login/`, open `https://track.toggl.com/timer`, then open Settings and click **Connect Toggl**. Approve access to Toggl Accounts and Track and confirm the connected-account label appears. To test recovery, sign out or clear either web session first; the extension should open the corresponding fixed Toggl page and succeed only after the session is ready and **Retry connection** is clicked.
3. Enter the Jira site URL. Leave Project ID blank to test automatic selection, or enter a valid project ID from the selected/default workspace, then click **Save settings**.
4. Click the toolbar icon and confirm it opens the extension side panel rather than a popup. Confirm the title header has a keyboard-accessible settings gear and no bottom Settings button. Confirm **Worked today**, **Worked this week**, and **Today's appointments** use the browser-local day.
5. Click a retained Jira-linked appointment name and confirm the underlined link opens its exact Jira issue in a new tab. Confirm normal appointments remain plain text. Then use **Play** on a previous row and confirm any current timer stops before the selected description starts with the saved workspace, optional project, and Billable default.
6. Open a Jira issue and click **Start in Toggl**. Confirm the entry uses the selected project, or has no project when the workspace has no eligible active project.
7. Refocus the side panel and confirm the order is title with its settings gear, totals, current timer, Jira progress, today's appointments, Stop timer, then conditional pending Work Logs. Resize it narrow and wide and confirm one vertical scroll surface and no horizontal overflow.
8. Beside the floating Jira timer button, click **Copy Jira title & description** and confirm the clipboard contains the issue key, summary, and Markdown description.
9. Choose each of the top-left, top-right, bottom-left, and bottom-right settings and confirm the Jira action group moves to that corner after refocusing or reloading Jira.
10. Stop the timer from the Jira button or extension side panel.
11. With Work Log sync enabled, confirm that stopping or switching a Jira-linked timer creates a Work Log automatically or queues it for confirmation, depending on the selected mode.
12. Replay a known Jira appointment and confirm its later stop follows the same Work Log behavior.
13. Test a manual appointment, including one whose text resembles a Jira key, and confirm it remains unrelated to Jira Work Log creation.

The extension does not require credentials supplied by the developer; reviewers use their own Jira and Toggl accounts.

The credentialed `GET /api/sessions` check and cookie-authenticated `GET https://track.toggl.com/api/v9/me` are Toggl web-app behavior, not documented stable public integration contracts. Their use as a connection sequence is an inference from Toggl's current official bundle. An unsupported response or failed public-API validation leaves any previously saved token unchanged.

## Listing assets

- Use `icons/icon128.png` as the 128×128 store icon.
- Provide at least one clear 1280×800 screenshot showing the settings page and one showing the side-panel insights beside Jira.
- Optional promotional images may be added for a stronger listing.
- Set the homepage, support, and privacy-policy URLs to the public repository pages.
- Verify the developer contact email and all required privacy-practice fields.
