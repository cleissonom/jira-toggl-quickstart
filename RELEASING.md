# Releasing

## Before tagging

1. Update `version` in `manifest.json` and `package.json` to the same value.
2. Add release notes to `CHANGELOG.md` and update user-facing documentation and privacy disclosures.
3. Run `npm run validate`.
4. Run `node --check background.js`, `node --check content.js`, `node --check options.js`, `node --check popup.js`, and `git diff --check`.
5. Confirm Settings has no API-token input. While signed in to Toggl Accounts and with `https://track.toggl.com/timer` open, click **Connect Toggl**, approve only `https://accounts.toggl.com/*` and `https://track.toggl.com/*`, and verify the connected account. Repeat with each web session unavailable: confirm the fixed Accounts login or Track timer page opens, make that session ready, and click **Retry connection**. Confirm denial, malformed-session/profile, blocked-cookie, and failed-validation paths do not replace an existing connection, and **Remove settings** removes both Toggl grants or reports that Chrome could not remove them.
6. Load the project through `chrome://extensions`, confirm Chrome 114 or newer, and verify that the toolbar action toggles a persistent side panel rather than a popup. Manually test optional-project and automatic-project setup, Jira start/stop, side-panel manual start/stop, Worked today, Worked this week, default/running icon transitions, Jira progress below/equal/above estimate, billable and non-billable timers, automatic Work Log sync, manual Work Log confirmation, and retry behavior.
7. Confirm the side-panel order is extension title, daily/weekly totals, current timer, Jira progress, Today's appointments, Stop timer, conditional pending Work Logs, then Settings. Resize the panel narrow and wide and confirm a long appointments list uses one vertical scroll surface, has no horizontal overflow, and leaves Settings reachable.
8. Confirm Today's appointments groups known Jira work and normalized manual descriptions correctly, clips totals to the browser-local day, advances the running row locally, and disables Play for that row.
9. Play a different appointment with automatic switching both enabled and disabled. Confirm the current timer always stops, linked Jira work is synchronized or queued before the new timer starts, and the selected description uses the current workspace, optional project, and Billable defaults.
10. Replay and stop a known Jira appointment, then confirm its new Work Log behavior. Also replay a manual description resembling a Jira key and confirm it remains Toggl-only.
11. On opened and board-selected Jira issues, test the adjacent Markdown copy action, its busy/success animation and reduced-motion behavior, and all four floating-button positions: top-left, top-right, bottom-left, and bottom-right. Confirm no clipboard permission was added.
12. Test a blank Project ID with related Toggl project data: the active project with the highest `actual_hours` in the selected workspace must be populated automatically.
13. Test a workspace with no active project: new timers must remain usable and omit `project_id`.
14. Confirm synchronized Jira Work Logs reduce the remaining estimate, `sidePanel` is the only intentional new required permission, `minimum_chrome_version` is 114, and the package keeps `manifest.json` at the ZIP root.
15. Open a release pull request against `main`. Wait for the strict `validate` check, resolve every review thread, obtain the required approval, and merge the reviewed pull request before tagging.

## Create a release

Create and push a tag that exactly matches the manifest version. For version 0.7.1:

```bash
git tag -a v0.7.1 -m "Release v0.7.1"
git push origin v0.7.1
```

The `Release extension package` workflow validates the project, creates a minimal Chrome Web Store ZIP, produces its SHA-256 checksum, attaches both files to a GitHub release, and prepends the matching changelog section to the generated comparison notes.

Never commit or upload a Chrome Web Store private signing key, a Toggl token, Jira credentials, browser cookies, clipboard content, or production issue data.
