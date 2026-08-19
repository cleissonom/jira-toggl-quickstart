# Releasing

## Before tagging

1. Update `version` in `manifest.json` and `package.json` to the same value.
2. Add release notes to `CHANGELOG.md`.
3. Run `npm run validate`.
4. Load the project through `chrome://extensions` and manually test settings, Jira start/stop, popup start/stop, billable and non-billable timers, timer switching, automatic Work Log sync, manual Work Log confirmation, and retry behavior.
5. Commit the release changes to `main` and wait for CI to pass.

## Create a release

Create and push a tag that exactly matches the manifest version. For version 0.4.0:

```bash
git tag -a v0.4.0 -m "Release v0.4.0"
git push origin v0.4.0
```

The `Release extension package` workflow validates the project, creates a minimal Chrome Web Store ZIP, produces its SHA-256 checksum, and attaches both files to a GitHub release.

Never commit or upload a Chrome Web Store private signing key, a Toggl token, Jira credentials, browser cookies, or production issue data.
