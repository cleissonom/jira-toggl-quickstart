# Chrome Web Store listing notes

This file is a maintainer checklist and source for the Chrome Web Store Developer Dashboard. Review every statement against the submitted version before publishing.

## Suggested short description

Start Toggl timers from Jira with daily totals, Jira progress, Markdown copy, and optional Work Log sync.

## Suggested detailed description

Jira → Toggl Quick Start turns the Jira issue you are viewing into a correctly formatted Toggl Track timer. The default description is `[{key}] {summary}`, and the format can be customized with Jira variables such as project, issue type, status, assignee, priority, labels, and components.

Every timer created by the extension is assigned to a required Toggl project. During setup, the extension validates that the project exists in the selected or default workspace; it never selects a project silently.

The toolbar popup shows **Worked today** for the browser-local day, including completed entries and the live portion of the running entry across all Toggl projects and workspaces. When the running entry is associated with a Jira issue, the popup shows Jira's logged time against the original estimate, including remaining or over-estimate time. A user-triggered button copies the Jira key, summary, and Markdown-converted description to the clipboard.

Optional Jira Work Log synchronization can create a Work Log when a timer started from the Jira button stops. Users can synchronize automatically or confirm pending entries from the popup, choose exact or rounded duration handling, and customize the Work Log comment. Failed requests remain in a local retry queue, and a Jira Work Log property is used to reduce duplicate submissions. The Jira remaining estimate is left unchanged.

The extension also provides a manual timer field in the toolbar popup, supports billable and non-billable defaults, and can stop the current timer automatically when switching work. Manual timers remain Toggl-only and are not matched to Jira issues for Work Log creation.

Setup is intentionally small: enter a Jira site URL, paste a Toggl API token, enter the required Toggl project ID, choose the defaults, and save. Jira access is requested at runtime for the exact HTTPS origin entered by the user.

This is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Atlassian or Toggl.

## Single purpose

Track Jira and related manual work in Toggl, present local Toggl/Jira work insights, copy Jira issue content on explicit request, and optionally record completed Jira-linked timers in Jira Work Logs.

## Permission justifications

- `storage`: stores the Toggl API token, required workspace/project configuration, user-selected settings, Jira-linked timer associations, and pending Work Log retry records in the local Chrome profile.
- `scripting`: dynamically registers the Jira content script only for the origin approved by the user.
- `https://api.track.toggl.com/*`: validates the Toggl account, workspace, and project; reads current and local-day time entries; and creates or stops time entries.
- Optional `https://*/*`: allows the user to approve one exact HTTPS Jira origin at runtime, including Jira Cloud, custom Jira domains, and compatible self-hosted deployments. The approved origin is used to read issue information, render the Jira button, show Jira progress, prepare user-requested Markdown copy, and optionally create Work Logs. The extension does not receive access to unrelated origins unless the user explicitly configures and approves a different Jira site.

No clipboard permission is requested. The popup writes to the clipboard only when the user clicks **Copy Jira title & description**.

## Privacy-practice declarations

The extension handles the following data only to provide its stated functionality:

- Authentication information: a Toggl API token, stored locally and sent only to the Toggl API over HTTPS.
- Personally identifiable information: the Toggl profile response may contain the user's display name or email and is used only to confirm the connected account in Settings.
- Website content: selected Jira issue fields, including summary, description, and time-tracking values; existing Work Log properties used for duplicate prevention; and the Work Log response from the configured Jira site.
- User-generated content: the rendered Jira timer description, a manually typed Toggl timer description, Jira content copied after an explicit click, and the optional Work Log comment configured by the user.
- Account and workspace metadata: Toggl profile, workspace, required project, current timer, and current-day time-entry information used to configure, operate, and display the integration.

The service worker calculates daily totals and Jira progress locally. Raw daily entry lists are not stored or exposed to unrelated pages. Jira issue content is copied only after the user explicitly clicks the copy button. When Work Log synchronization is enabled, the extension sends the issue key, timer start time, duration, optional comment, and Toggl identifiers to the configured Jira site.

The extension has no backend, advertising, analytics, data sale, or developer-operated data collection. It does not send data to the extension author.

Use the public `PRIVACY.md` URL in the Developer Dashboard after the repository is published.

## Reviewer test instructions

1. Use a Jira site where the reviewer is signed in and has **Browse projects** permission; **Work on issues** is also required to test Work Log creation.
2. Open Settings, enter the Jira site URL, a Toggl Track API token, and a valid Toggl project ID from the selected/default workspace, then click **Connect and save**.
3. Open the popup and confirm **Worked today** loads for the current browser-local day.
4. Open a Jira issue and click **Start in Toggl**. Confirm the created Toggl entry uses the configured project.
5. Reopen the popup and confirm Jira progress appears when the issue has time-tracking data.
6. Click **Copy Jira title & description** and confirm the clipboard contains the issue key, summary, and Markdown description.
7. Stop the timer from the Jira button or extension popup.
8. With Work Log sync enabled, confirm that a Work Log is created automatically or appears in the popup for confirmation, depending on the selected mode.
9. A manual timer can be tested from the popup; it must also use the configured project and remains unrelated to Jira Work Log creation.

The extension does not require credentials supplied by the developer; reviewers use their own Jira and Toggl accounts.

## Listing assets

- Use `icons/icon128.png` as the 128×128 store icon.
- Provide at least one clear 1280×800 screenshot showing the settings page and one showing the popup insights.
- Optional promotional images may be added for a stronger listing.
- Set the homepage, support, and privacy-policy URLs to the public repository pages.
- Verify the developer contact email and all required privacy-practice fields.
