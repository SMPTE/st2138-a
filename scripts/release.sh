#!/usr/bin/env bash
#
# Local releaser. Runs on a maintainer's machine and does everything the
# "Release - open" workflow used to do EXCEPT open the PR: it branches off
# develop, stamps the release version, rebuilds the generated artifacts,
# commits, and pushes the release branch. It then prints the compare URL for
# you to open the PR yourself.
#
# Opening that PR by hand is deliberate, not laziness about the API: a PR
# opened by a human triggers the pull_request checks (tests, proto-lint,
# example validation), whereas one opened by automation with GITHUB_TOKEN
# would be silently exempted from them.
#
# Usage:
#   scripts/release.sh [-y] [version]
#     -y        Skip the confirmation prompt before pushing.
#     version   Explicit release version. If omitted, strips the trailing
#               .dev/-dev from develop's VERSION (see release-version.sh).
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

assume_yes=0
while getopts ":y" opt; do
    case "$opt" in
    y) assume_yes=1 ;;
    *)
        echo "usage: $0 [-y] [version]" >&2
        exit 2
        ;;
    esac
done
shift $((OPTIND - 1))
INPUT_VERSION="${1:-}"

die() {
    echo "error: $*" >&2
    exit 1
}

# Must be on a clean develop that matches the remote, so the release branches
# off exactly what everyone else sees on develop.
[[ -z "$(git status --porcelain)" ]] ||
    die "working tree is dirty; commit or stash first"

branch_now="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch_now" == "develop" ]] ||
    die "run this from 'develop' (currently on '$branch_now')"

git fetch --quiet origin develop --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/develop)" ]] ||
    die "local develop is not in sync with origin/develop; pull/push first"

CURRENT="$(tr -d '[:space:]' < VERSION)"
if [[ -n "$INPUT_VERSION" ]]; then
    RELEASE="$INPUT_VERSION"
else
    RELEASE="$(bash ./scripts/release-version.sh release "$CURRENT")"
fi
BRANCH="release/$RELEASE"

# Guard against re-releasing: a tag or branch (here or on the remote) means
# this version is already in flight or done.
if git rev-parse -q --verify "refs/tags/$RELEASE" >/dev/null ||
    git ls-remote --exit-code --tags origin "refs/tags/$RELEASE" >/dev/null 2>&1; then
    die "tag '$RELEASE' already exists; choose a different version"
fi
if git rev-parse -q --verify "refs/heads/$BRANCH" >/dev/null ||
    git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null 2>&1; then
    die "branch '$BRANCH' already exists; delete it or choose a different version"
fi

echo "Releasing '$RELEASE' from develop '$CURRENT' on branch '$BRANCH'."
if [[ "$assume_yes" -ne 1 ]]; then
    read -r -p "Create, commit, and push '$BRANCH'? [y/N] " reply </dev/tty
    [[ "$reply" == [yY] || "$reply" == [yY][eE][sS] ]] || die "aborted"
fi

git switch -c "$BRANCH"
printf '%s\n' "$RELEASE" > VERSION
bash ./scripts/set-version.sh
bash ./build-openapi.sh
git add -A
git commit -m "Release $RELEASE"
git push --set-upstream origin "$BRANCH"

# Derive owner/repo from origin for the compare link (ssh or https remote).
slug="$(git remote get-url origin | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##')"

cat <<EOF

Pushed '$BRANCH'. Now open the release PR yourself so CI runs:

  https://github.com/$slug/compare/main...$BRANCH?expand=1

  Base: main   Compare: $BRANCH   Title: Release $RELEASE

When merging that PR, use "Create a merge commit" — NOT squash or rebase.
The tag on main and the develop back-merge both depend on the real commits,
and scripts/post-release.sh will refuse a squashed merge.
EOF
