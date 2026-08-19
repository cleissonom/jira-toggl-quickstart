# Chrome Web Store listing notes

This file is a maintainer checklist and source for the Chrome Web Store Developer Dashboard. Review every statement against the submitted version before publishing.

## Suggested short description

Start Toggl timers from Jira in one click and optionally sync completed Jira timers to Work Logs.

## Suggested detailed description

Jira → Toggl Quick Start turns the Jira issue you are viewing into a correctly formatted Toggl Track timer. The default description is `[{key}] {summary}`, and the format can be customized with Jira variables such as project, issue type, status, assignee, priority, labels, and components.

Optional Jira Work Log synchronization can create a Work Log when a timer started from the Jira button stops. Users can synchronize automatically or confirm pending entries from the popup, choose exact or rounded duration handling, and customize the Work Log comment. Failed requests remain in a local retry queue, and a Jira Work Log property is used to reduce duplicate submissions. The Jira remaining estimate is left unchanged.

The extension also provides a manual timer field in the toolbar popup, supports billable and non-billable defaults, can assign timers to a fixed Toggl project, and can stop the current timer automatically when switching work. Manual timers remain Toggl-only and are not matched to Jira issues.

Setup is intentionally small: enter a Jira site URL, paste a Toggl API token, choose the defaults, and save. Jira access is requested at runtime for the exact HTTPS origin entered by the user.

This is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Atlassian or Toggl.

## Single purpose

Track Jira work in Toggl and optionally record completed Jira-linked timers in Jira Work Logs, with a manual Toggl entry option for closely related time tracking.

## Permission justifications

- `storage`: stores the Toggl API token, user-selected settings, Jira-linked timer associations, and pending Work Log retry records in the local Chrome profile.
- `scripting`: dynamically registers the Jira content script only for the origin approved by the user.
- `https://api.track.toggl.com/*`: validates the Toggl account and creates, reads, or stops time entries.
- Optional `https://*/*`: allows the user to approve one exact HTTPS Jira origin at runtime, including Jira Cloud, custom Jira domains, and compatible self-hosted deployments. The approved origin is used to read issue information, render the Jira button, and optionally create Work Logs. The extension does not receive access to unrelated origins unless the user explicitly configures and approves a different Jira site.

## Privacy-practice declarations

The extension handles the following data only to provide its stated functionality:

- Authentication information: a Toggl API token, stored locally and sent only to the Toggl API over HTTPS.
- Personally identifiable information: the Toggl profile response may contain the user's display name or email and is used only to confirm the connected account in Settings.
- Website content: selected Jira issue fields, existing Work Log properties used for duplicate prevention, and the Work Log response from the configured Jira site.
- User-generated content: the rendered Jira timer description, a manually typed Toggl timer description, and the optional Work Log comment configured by the user.
- Account and workspace metadata: Toggl profile, workspace, project, time-entry, and current-timer information used to configure and operate the integration.

When Work Log synchronization is enabled, the extension sends the issue key, timer start time, duration, optional comment, and Toggl identifiers to the configured Jira site. The extension has no backend, advertising, analytics, data sale, or developer-operated data collection. It does not send data to the extension author.

Use the public `PRIVACY.md` URL in the Developer Dashboard after the repository is published.

## Reviewer test instructions

1. Use a Jira site where the reviewer is signed in and has **Browse projects** and **Work on issues** permission, with time tracking enabled.
2. Open Settings, enter the Jira site URL and a Toggl Track API token, and click **Connect and save**.
3. Open a Jira issue and click **Start in Toggl**.
4. Stop the timer from the Jira button or extension popup.
5. With Work Log sync enabled, confirm that a Work Log is created automatically or appears in the popup for confirmation, depending on the selected mode.
6. A manual timer can be tested from the popup without enabling Work Log synchronization.

The extension does not require credentials supplied by the developer; reviewers use their own Jira and Toggl accounts.

## Listing assets

- Use `icons/icon128.png` as the 128×128 store icon.
- Provide at least one clear 1280×800 screenshot of the settings page or Jira button.
- Optional promotional images may be added for a stronger listing.
- Set the homepage, support, and privacy-policy URLs to the public repository pages.
- Verify the developer contact email and all required privacy-practice fields.
