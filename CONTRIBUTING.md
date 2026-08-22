# Contributing

Thank you for improving Jira → Toggl Quick Start.

## Development workflow

1. Fork or clone the repository.
2. Create a focused branch.
3. Make the change using plain JavaScript, HTML, and CSS with no remote runtime dependencies.
4. Keep user-facing text, source comments, tests, and documentation in English.
5. Run:

```bash
npm run validate
```

6. Load the directory through `chrome://extensions`, reload the extension, and test against a Jira account and a non-production Toggl workspace when possible.
7. Open a pull request describing the behavior change, security implications, and manual test performed.

## Pull request expectations

- Keep permissions as narrow as the feature allows.
- Never log or expose API tokens.
- Add or update service-worker tests for behavior and security changes.
- Add or update UI contract tests for settings, side-panel, or manifest changes.
- Keep the default template `[{key}] {summary}` unless a breaking change is explicitly justified.
- Avoid site-specific company names, URLs, issue keys, or credentials in production defaults and documentation examples.
- Update `README.md` and `CHANGELOG.md` for user-visible changes.

## Community standards

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security vulnerabilities through a private GitHub security advisory rather than a public issue.
