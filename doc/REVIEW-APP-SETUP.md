# Repository-owned review app

The review workflow authenticates as a GitHub App. The default app ID belongs to
the upstream `commitperclip` app. Installing that app in a fork does not provide
its developer's private key. Fork owners must use an app they own and configure
its identity explicitly.

## Configuration

In repository Actions settings, configure:

| Setting | Type | Value |
| --- | --- | --- |
| `COMMITPERCLIP_APP_ID` | Variable | Positive numeric App ID from the app's General settings |
| `COMMITPERCLIP_BOT_LOGIN` | Variable | App slug, optionally followed by `[bot]` |
| `COMMITPERCLIP_KEY` | Secret | Private key generated for that same app |

The owner should create a private GitHub App, disable webhooks, and install it
only in the repository being reviewed. The gate scripts need these repository
permissions:

- Contents: read, to inspect base files and pull-request patches.
- Pull requests: read and write, to read PR metadata and maintain review comments.
- Checks: read and write, to report the security check result.
- Repository security advisories: read and write, to maintain private draft findings.
- Metadata: read (GitHub requires this).

No account permissions, repository-administration permissions, code-write access,
or access to other repositories are needed. Keep the private key in the Actions
secret; never paste it into an issue, PR, transcript, or source file.

GitHub documents advisory permissions at
<https://docs.github.com/en/rest/security-advisories/repository-advisories>.

## Verification and bootstrap

The `pull_request_target` review continues to check out `master`; it never
executes a PR's proposed gate scripts with the app credential. Dependency Review,
all six quality gates, and all six security scans remain unchanged. The normal
PR workflow also runs the review-script unit tests without the app key.

An administrator must review and establish this configuration on the trusted
base before it can unblock existing PR reviews. A PR branch alone does not
change the trusted review runner. This document does not authorize bypassing a
failed check, bypassing branch protection, or merging a feature before review.

After the configuration has been reviewed and established on `master`, trigger
a fresh `synchronize` or `reopened` pull-request event. Do not rely on replaying
a pre-configuration run: GitHub re-runs retain the original event's commit and
ref, and that workflow did not pass the new app variables. See
[GitHub's re-run documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).
Once the run uses the configured workflow, ordinary failed-job retries are valid.

Inspect every step, including token creation, quality gates, and security gates.
Verify the `security-review`
check belongs to the current PR head; inspect and resolve any draft advisory.
The existing advisory-only security reporting behavior is not a substitute for
release acceptance. Review approval and production acceptance remain separate.

Missing or invalid app configuration fails before any review can be reported as
successful. No personal-token or anonymous fallback is introduced.
