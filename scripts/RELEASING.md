# Releasing

This repo uses a `develop` → `release/*` → `main` flow. The version-stamping
and branch work is scripted ([release.sh](release.sh)); opening the pull
requests is left to a human on purpose, so that the `pull_request` checks
(tests, proto-lint, example validation) actually run — a PR opened by Actions
with `GITHUB_TOKEN` would be silently exempt from them.

## Prerequisites

- A clean checkout on `develop`, in sync with `origin/develop`.
- Push access to the repository.
- The tooling installed (`./install-tooling.sh`), since the releaser rebuilds
  generated artifacts via [set-version.sh](set-version.sh) and
  `../build-openapi.sh`.

## 1. Cut the release branch

From `develop`:

```bash
scripts/release.sh            # strips the trailing .dev from develop's VERSION
scripts/release.sh v1.3.0     # or pass an explicit release version
```

The script refuses to run on a dirty tree, off `develop`, or when `develop` is
out of sync with the remote. It then:

1. Resolves the release version (via [release-version.sh](release-version.sh)).
2. Guards against an existing tag or `release/<version>` branch, locally and on
   the remote.
3. Creates `release/<version>`, writes `VERSION`, runs `set-version.sh` and
   `build-openapi.sh`, commits `Release <version>`, and pushes the branch.
4. Prints the compare URL for the next step.

## 2. Open the PR to `main`

Open the URL the script printed:

```
https://github.com/<owner>/<repo>/compare/main...release/<version>?expand=1
```

- **Base:** `main`  **Compare:** `release/<version>`  **Title:** `Release <version>`
- Confirm CI is green and the version number is correct.

> **Merge with a real merge commit — do NOT squash or rebase.** Keeping the
> real commits preserves history for the tag and the develop back-merge. GitHub
> remembers your last merge choice, so explicitly pick **"Create a merge
> commit"**.

## 3. Merge into main

Merge the PR with a merge commit. Nothing is published yet — tagging (next
step) drives publishing.

## 4. Tag, publish, and bump develop

Check out the `release/<version>` branch and run the post-releaser:

```bash
git switch release/<version> && git pull
scripts/post-release.sh            # derives the next dev version
scripts/post-release.sh v1.4.0-dev # or pass an explicit next version
```

It tags the release commit (which triggers
[publish.yml](../.github/workflows/publish.yml) — GitHub Pages + GitHub
Release), then bumps `VERSION` to the next dev version, rebuilds, commits
`Begin <next> development`, pushes the branch, and prints the compare URL for a
PR into `develop`. It refuses to run unless the release commit is on `main`
(i.e. the PR was merged with a merge commit). Open that PR and merge it with a
**merge commit**.

After it merges, delete the release branch yourself (the script prints the
command):

```bash
git push origin --delete release/<version>
```

## Recovering from mistakes

- **Wrong version or bad build (before tagging):** delete the
  `release/<version>` branch (local and remote) and re-run the releaser.
- **Tag/VERSION mismatch:** `publish.yml` fails its gate. Fix `VERSION` (or the
  tag), then re-push a matching tag.
- **Need to re-publish:** delete and re-push the tag, or push a corrected one.
