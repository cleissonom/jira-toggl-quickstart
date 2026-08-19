# Chrome Web Store listing notes

This file is a maintainer checklist and source for the Chrome Web Store Developer Dashboard. Review every statement against the submitted version before publishing.

## Suggested short description

Start and stop Toggl Track timers from Jira issues in one click, or start a manual timer from the extension popup.

## Suggested detailed description

Jira → Toggl Quick Start turns the Jira issue you are viewing into a correctly formatted Toggl Track timer. The default description is `[{key}] {summary}`, and the format can be customized with Jira variables such as project, issue type, status, assignee, priority, labels, and components.

The extension also provides a manual timer field in the toolbar popup, supports billable and non-billable defaults, can assign timers to a fixed Toggl project, and can stop the current timer automatically when switching work.

Setup is intentionally small: enter a Jira site URL, paste a Toggl API token, choose the billable default, and save. Jira access is requested at runtime for the exact HTTPS origin entered by the user.

This is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Atlassian or Toggl.

## Single purpose

Help a user start and stop Toggl Track time entries for Jira work, with a manual entry option for closely related time tracking.

## Permission justifications

- `storage`: stores the Toggl API token and user-selected settings in the local Chrome profile.
- `scripting`: dynamically registers the Jira content script only for the origin approved by the user.
- `https://api.track.toggl.com/*`: validates the Toggl account and creates, reads, or stops time entries.
- Optional `https://*/*`: allows the user to approve one exact HTTPS Jira origin at runtime, including Jira Cloud, custom Jira domains, and compatible self-hosted deployments. The extension does not receive access to other origins unless the user explicitly configures and approves a different Jira site.

## Privacy-practice declarations

The extension handles the following data only to provide its stated functionality:

- Authentication information: a Toggl API token, stored locally and sent only to the Toggl API over HTTPS.
- Website content: selected Jira issue fields required by the user's description template, processed locally.
- User-generated content: the rendered Jira timer description or a manually typed timer description, sent to Toggl when the user starts a timer.
- Account and workspace metadata: Toggl profile, workspace, project, and current timer information, used to configure and display the integration.

The extension has no backend, advertising, analytics, data sale, or developer-operated data collection. It does not send data to the extension author.

Use the public `PRIVACY.md` URL in the Developer Dashboard after the repository is published.

## Assets still required in the Developer Dashboard

- At least one clear screenshot of the settings page or Jira button.
- A 128×128 store icon from `icons/icon128.png`.
- Optional promotional images for a stronger listing.
- Homepage URL, support URL, and privacy policy URL.
- Verified developer contact email and all required privacy-practice fields.
- Test instructions that explain how reviewers can use their own Jira site and Toggl token.
