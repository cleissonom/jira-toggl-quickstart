# Releasing

## Before tagging

1. Update `version` in `manifest.json` and `package.json` to the same value.
2. Add release notes to `CHANGELOG.md` and update user-facing documentation and privacy disclosures.
3. Run `npm run validate`.
4. Run `node --check background.js`, `node --check content.js`, `node --check options.js`, `node --check popup.js`, and `git diff --check`.
5. Load the project through `chrome://extensions` and manually test required-project setup, Jira start/stop, popup manual start/stop, Worked today, Jira progress below/equal/above estimate, Markdown copy, billable and non-billable timers, timer switching, automatic Work Log sync, manual Work Log confirmation, and retry behavior.
6. Test an upgrade profile without a saved project ID: Settings must open, new timers must remain blocked, and an existing timer must remain readable and stoppable.
7. Confirm all created entries contain the configured `project_id`, no new permissions were added unintentionally, and the package keeps `manifest.json` at the ZIP root.
8. Commit the release changes to `main` and wait for CI to pass.

## Create a release

Create and push a tag that exactly matches the manifest version. For version 0.5.0:

```bash
git tag -a v0.5.0 -m "Release v0.5.0"
git push origin v0.5.0
```

The `Release extension package` workflow validates the project, creates a minimal Chrome Web Store ZIP, produces its SHA-256 checksum, and attaches both files to a GitHub release.

Never commit or upload a Chrome Web Store private signing key, a Toggl token, Jira credentials, browser cookies, clipboard content, or production issue data.
